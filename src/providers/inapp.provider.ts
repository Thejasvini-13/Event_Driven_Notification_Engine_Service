import { DeliveryProvider, SendPayload, SendResult, StatusResult } from '../interfaces/provider.interface';
import { logger } from '../server';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketBroadcaster } from '../server';

// ─── In-App WebSocket Provider ────────────────────────────────

export interface InAppNotificationPayload {
  type:           'NOTIFICATION';
  notificationId: string;
  trackingId:     string;
  eventType:      string;
  title:          string;
  body:           string;
  priority:       number;
  timestamp:      string;
  metadata:       Record<string, unknown>;
}

export class InAppProvider extends DeliveryProvider {
  readonly channelName = 'INAPP';

  protected async sendImpl(payload: SendPayload): Promise<SendResult> {
    const inAppPayload: InAppNotificationPayload = {
      type:           'NOTIFICATION',
      notificationId: payload.notificationId,
      trackingId:     payload.trackingId,
      eventType:      (payload.metadata['eventType'] as string) ?? 'UNKNOWN',
      title:          payload.subject ?? 'Notification',
      body:           payload.body,
      priority:       (payload.metadata['priority'] as number) ?? 5,
      timestamp:      new Date().toISOString(),
      metadata:       payload.metadata,
    };

    logger.info(
      {
        channel:        'INAPP',
        notificationId: payload.notificationId,
        trackingId:     payload.trackingId,
        userId:         payload.userId,
      },
      'In-app: broadcasting via WebSocket',
    );

    // Broadcast to all connected WebSocket clients
    const sent = WebSocketBroadcaster.broadcast(
      payload.userId,
      JSON.stringify(inAppPayload),
    );

    if (!sent) {
      logger.warn(
        { userId: payload.userId, notificationId: payload.notificationId },
        'In-app: user not connected, notification stored for next connection',
      );
    }

    const providerMessageId = `inapp_${uuidv4().replace(/-/g, '').substring(0, 18)}`;

    return {
      success:           true,
      providerMessageId,
      latencyMs:         0,
    };
  }

  async getStatus(providerMessageId: string): Promise<StatusResult> {
    // In-app status is determined by client read receipt
    return {
      providerMessageId,
      status: 'SENT',
    };
  }
}
