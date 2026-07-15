import { DeliveryProvider, SendPayload, SendResult, StatusResult } from '../interfaces/provider.interface';
import { logger } from '../server';
import { v4 as uuidv4 } from 'uuid';

// ─── MSG91 / Twilio SMS Provider (Sandbox Mock) ───────────────

interface SmsMessage {
  to:      string;
  from:    string;
  body:    string;
  unicode: boolean;
}

export class SmsProvider extends DeliveryProvider {
  readonly channelName = 'SMS';
  private readonly maxLength = 160;

  protected async sendImpl(payload: SendPayload): Promise<SendResult> {
    // Truncate to 160 chars (GSM7 standard)
    const body = payload.body.length > this.maxLength
      ? payload.body.substring(0, this.maxLength - 3) + '...'
      : payload.body;

    const smsMessage: SmsMessage = {
      to:      payload.recipient,
      from:    process.env['MSG91_SENDER_ID'] ?? 'NOTIFN',
      body,
      unicode: /[^\u0000-\u007F]/.test(body),  // unicode if non-ASCII (Hindi/Tamil etc.)
    };

    logger.info(
      {
        channel:        'SMS',
        notificationId: payload.notificationId,
        trackingId:     payload.trackingId,
        to:             payload.recipient.replace(/\d{6}$/, '******'), // mask last 6
        bodyLength:     body.length,
        unicode:        smsMessage.unicode,
      },
      'SMS sandbox: sending message',
    );

    // ── Sandbox simulation ────────────────────────────────────
    await this.simulateNetworkDelay(50, 300);

    // Simulate 5% failure rate
    if (Math.random() < 0.05) {
      throw new Error('SMS provider: temporary gateway error (sandbox)');
    }

    const providerMessageId = `sms_${uuidv4().replace(/-/g, '').substring(0, 20)}`;

    logger.info(
      {
        channel:           'SMS',
        notificationId:    payload.notificationId,
        providerMessageId,
      },
      'SMS sandbox: message accepted',
    );

    return {
      success:           true,
      providerMessageId,
      latencyMs:         0, // filled by base class
    };
  }

  async getStatus(providerMessageId: string): Promise<StatusResult> {
    await this.simulateNetworkDelay(20, 100);

    // Sandbox: always return DELIVERED after ~2s
    return {
      providerMessageId,
      status:      'DELIVERED',
      deliveredAt: new Date(Date.now() - 2000),
    };
  }

  private simulateNetworkDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    return new Promise(r => setTimeout(r, delay));
  }
}
