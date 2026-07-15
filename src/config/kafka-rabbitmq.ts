import { Kafka, Producer, Consumer, Admin, logLevel, KafkaMessage } from 'kafkajs';
import * as amqplib from 'amqplib';
import type { Channel, ConsumeMessage, ChannelModel } from 'amqplib';
import { logger } from '../server';

// ─── Types ────────────────────────────────────────────────────

export interface KafkaClients {
  kafka: Kafka;
  producer: Producer;
  criticalConsumer: Consumer;
  standardConsumer: Consumer;
  admin: Admin;
}

export interface RabbitMQClients {
  connection: ChannelModel;
  channel: Channel;
}

export interface KafkaEventMessage {
  trackingId: string;
  eventType: string;
  userId: string;
  sourceEntityId: string;
  payload: Record<string, unknown>;
  priority: number;
  timestamp: string;
  locale?: string;
  channels?: string[];
}

// ─── Kafka Setup ──────────────────────────────────────────────

let kafkaClients: KafkaClients | null = null;

export async function initializeKafka(): Promise<KafkaClients> {
  const brokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');

  const kafka = new Kafka({
    clientId:  process.env['KAFKA_CLIENT_ID'] ?? 'notification-engine',
    brokers,
    logLevel:  logLevel.WARN,
    retry: {
      initialRetryTime: 300,
      retries:          10,
      factor:           2,
      maxRetryTime:     30_000,
    },
    connectionTimeout: 10_000,
    requestTimeout:    30_000,
  });

  const admin = kafka.admin();
  await admin.connect();

  // Ensure topics exist with proper partition counts
  const topicCritical = process.env['KAFKA_TOPIC_CRITICAL'] ?? 'fin-events-critical';
  const topicStandard = process.env['KAFKA_TOPIC_STANDARD'] ?? 'fin-events-standard';
  const topicDLQ      = process.env['KAFKA_TOPIC_DLQ']      ?? 'fin-events-dlq';

  const existingTopics = await admin.listTopics();
  const topicsToCreate = [topicCritical, topicStandard, topicDLQ].filter(
    t => !existingTopics.includes(t),
  );

  if (topicsToCreate.length > 0) {
    await admin.createTopics({
      topics: topicsToCreate.map(topic => ({
        topic,
        numPartitions:     topic === topicCritical ? 3 : 6,
        replicationFactor: 1,
        configEntries: [
          { name: 'retention.ms',      value: String(7 * 24 * 60 * 60 * 1000) },
          { name: 'compression.type',  value: 'snappy' },
          { name: 'min.insync.replicas', value: '1' },
        ],
      })),
      waitForLeaders: true,
    });
    logger.info({ topicsToCreate }, 'Kafka topics created');
  }

  // Producer with idempotence
  const producer = kafka.producer({
    idempotent:                       true,
    maxInFlightRequests:              5,
    allowAutoTopicCreation:           true,
  });
  await producer.connect();

  // Critical consumer group (Priority 1 — fewer partitions, dedicated)
  const criticalConsumer = kafka.consumer({
    groupId:          process.env['KAFKA_GROUP_CRITICAL'] ?? 'notification-critical',
    sessionTimeout:   30_000,
    heartbeatInterval: 3_000,
    maxBytesPerPartition: 1_048_576, // 1 MB
  });
  await criticalConsumer.connect();
  await criticalConsumer.subscribe({
    topic:     topicCritical,
    fromBeginning: false,
  });

  // Standard consumer group (bulk load)
  const standardConsumer = kafka.consumer({
    groupId:          process.env['KAFKA_GROUP_STANDARD'] ?? 'notification-events',
    sessionTimeout:   30_000,
    heartbeatInterval: 3_000,
    maxBytesPerPartition: 10_485_760, // 10 MB
  });
  await standardConsumer.connect();
  await standardConsumer.subscribe({
    topic:     topicStandard,
    fromBeginning: false,
  });

  kafkaClients = { kafka, producer, criticalConsumer, standardConsumer, admin };
  logger.info('Kafka clients initialized');
  return kafkaClients;
}

export function getKafkaClients(): KafkaClients {
  if (!kafkaClients) throw new Error('Kafka not initialized. Call initializeKafka() first.');
  return kafkaClients;
}

export async function publishToKafka(
  topic: string,
  message: KafkaEventMessage,
  headers: Record<string, string> = {},
): Promise<void> {
  const { producer } = getKafkaClients();
  await producer.send({
    topic,
    messages: [{
      key:   message.userId,
      value: JSON.stringify(message),
      headers: {
        'tracking-id': message.trackingId,
        'event-type':  message.eventType,
        ...headers,
      },
    }],
  });
}

export function parseKafkaMessage(message: KafkaMessage): KafkaEventMessage | null {
  try {
    if (!message.value) return null;
    return JSON.parse(message.value.toString()) as KafkaEventMessage;
  } catch (err) {
    logger.error({ err }, 'Failed to parse Kafka message');
    return null;
  }
}

export async function shutdownKafka(): Promise<void> {
  if (kafkaClients) {
    await kafkaClients.criticalConsumer.disconnect();
    await kafkaClients.standardConsumer.disconnect();
    await kafkaClients.producer.disconnect();
    await kafkaClients.admin.disconnect();
    kafkaClients = null;
    logger.info('Kafka clients shut down');
  }
}

// ─── RabbitMQ Setup ───────────────────────────────────────────

let rabbitClients: RabbitMQClients | null = null;

const RABBIT_QUEUES = [
  'notif.sms',
  'notif.email',
  'notif.push',
  'notif.whatsapp',
  'notif.inapp',
  'notif.dlq',
] as const;

export type RabbitQueue = (typeof RABBIT_QUEUES)[number];

export async function initializeRabbitMQ(): Promise<RabbitMQClients> {
  const url = process.env['RABBITMQ_URL'] ?? 'amqp://guest:guest@localhost:5672';

  const connection = await amqplib.connect(url) as ChannelModel;
  connection.on('error', (err: Error) => {
    logger.error({ err }, 'RabbitMQ connection error');
  });
  connection.on('close', () => {
    logger.warn('RabbitMQ connection closed');
  });

  const channel = await connection.createChannel();
  await channel.prefetch(50); // fair dispatch

  const exchange = process.env['RABBITMQ_EXCHANGE'] ?? 'notifications';
  await channel.assertExchange(exchange, 'direct', { durable: true });

  // Assert all delivery queues with DLQ routing
  for (const q of RABBIT_QUEUES) {
    if (q === 'notif.dlq') {
      await channel.assertQueue(q, {
        durable:    true,
        arguments: { 'x-queue-type': 'classic' },
      });
    } else {
      await channel.assertQueue(q, {
        durable:   true,
        arguments: {
          'x-dead-letter-exchange':    exchange,
          'x-dead-letter-routing-key': 'notif.dlq',
          'x-message-ttl':             1_800_000,  // 30-min TTL
          'x-queue-type':              'classic',
        },
      });
    }
    await channel.bindQueue(q, exchange, q);
  }

  rabbitClients = { connection, channel };
  logger.info('RabbitMQ clients initialized');
  return rabbitClients;
}

export function getRabbitClients(): RabbitMQClients {
  if (!rabbitClients) throw new Error('RabbitMQ not initialized. Call initializeRabbitMQ() first.');
  return rabbitClients;
}

export async function publishToQueue(
  queue: RabbitQueue,
  payload: Record<string, unknown>,
  options: { priority?: number; expiration?: string } = {},
): Promise<void> {
  const { channel } = getRabbitClients();
  const exchange = process.env['RABBITMQ_EXCHANGE'] ?? 'notifications';
  const content = Buffer.from(JSON.stringify(payload));
  channel.publish(exchange, queue, content, {
    persistent:  true,
    contentType: 'application/json',
    priority:    options.priority ?? 5,
    expiration:  options.expiration,
    timestamp:   Math.floor(Date.now() / 1000),
  });
}

export async function consumeQueue(
  queue: RabbitQueue,
  handler: (msg: ConsumeMessage) => Promise<void>,
): Promise<void> {
  const { channel } = getRabbitClients();
  await channel.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      await handler(msg);
      channel.ack(msg);
    } catch (err) {
      logger.error({ err, queue }, 'Queue consumer handler failed — nack with requeue');
      channel.nack(msg, false, msg.fields.redelivered ? false : true);
    }
  });
}

export async function shutdownRabbitMQ(): Promise<void> {
  if (rabbitClients) {
    try { await rabbitClients.channel.close(); } catch { /* ignore */ }
    try { await (rabbitClients.connection as ChannelModel & { close(): Promise<void> }).close(); } catch { /* ignore */ }
    rabbitClients = null;
    logger.info('RabbitMQ clients shut down');
  }
}
