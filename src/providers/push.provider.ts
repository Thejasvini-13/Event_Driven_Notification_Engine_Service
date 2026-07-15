import { DeliveryProvider, SendPayload, SendResult, StatusResult } from '../interfaces/provider.interface';
import { logger } from '../server';
import { v4 as uuidv4 } from 'uuid';

// ─── FCM Push Provider (Sandbox Mock) ────────────────────────

interface FcmPayload {
  token:       string;
  notification: {
    title: string;
    body:  string;
  };
  data:     Record<string, string>;
  android?: { priority: 'normal' | 'high' };
  apns?:   { headers: { 'apns-priority': string } };
}

export class PushProvider extends DeliveryProvider {
  readonly channelName = 'PUSH';

  protected async sendImpl(payload: SendPayload): Promise<SendResult> {
    const fcmPayload: FcmPayload = {
      token:        payload.recipient, // FCM device token
      notification: {
        title: payload.subject ?? 'Notification',
        body:  payload.body.substring(0, 200), // FCM body limit
      },
      data: {
        trackingId:     payload.trackingId,
        notificationId: payload.notificationId,
        ...(payload.metadata as Record<string, string>),
      },
      android: { priority: (payload.metadata['priority'] as number ?? 5) <= 2 ? 'high' : 'normal' },
      apns:    { headers: { 'apns-priority': (payload.metadata['priority'] as number ?? 5) <= 2 ? '10' : '5' } },
    };

    logger.info(
      {
        channel:        'PUSH',
        notificationId: payload.notificationId,
        trackingId:     payload.trackingId,
        tokenPrefix:    payload.recipient.substring(0, 12) + '...',
        title:          fcmPayload.notification.title,
      },
      'Push sandbox: sending FCM message',
    );

    await this.simulateNetworkDelay(30, 150);

    // Simulate 2% token expiry / failure
    if (Math.random() < 0.02) {
      throw new Error('Push provider: token not registered (sandbox)');
    }

    const providerMessageId = `fcm_${uuidv4().replace(/-/g, '').substring(0, 22)}`;

    logger.info(
      {
        channel:           'PUSH',
        notificationId:    payload.notificationId,
        providerMessageId,
      },
      'Push sandbox: FCM message sent',
    );

    return {
      success:           true,
      providerMessageId,
      latencyMs:         0,
    };
  }

  async getStatus(providerMessageId: string): Promise<StatusResult> {
    return {
      providerMessageId,
      status:      'DELIVERED',
      deliveredAt: new Date(),
    };
  }

  private simulateNetworkDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    return new Promise(r => setTimeout(r, delay));
  }
}
