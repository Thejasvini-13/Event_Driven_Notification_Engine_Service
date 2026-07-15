import { DeliveryProvider, SendPayload, SendResult, StatusResult } from '../interfaces/provider.interface';
import { logger } from '../server';
import { v4 as uuidv4 } from 'uuid';

// ─── Meta WhatsApp Cloud API Provider (Sandbox Mock) ─────────

interface WhatsAppTextMessage {
  messaging_product: 'whatsapp';
  recipient_type:    'individual';
  to:                string;
  type:              'text';
  text:              { preview_url: boolean; body: string };
}

interface WhatsAppTemplateMessage {
  messaging_product: 'whatsapp';
  recipient_type:    'individual';
  to:                string;
  type:              'template';
  template: {
    name:       string;
    language:   { code: string };
    components: Array<{
      type:       string;
      parameters: Array<{ type: string; text: string }>;
    }>;
  };
}

type WhatsAppMessage = WhatsAppTextMessage | WhatsAppTemplateMessage;

export class WhatsAppProvider extends DeliveryProvider {
  readonly channelName = 'WHATSAPP';

  protected async sendImpl(payload: SendPayload): Promise<SendResult> {
    const phone = this.normalizePhone(payload.recipient);

    // Use template message if templateId is provided, else text
    const waMessage: WhatsAppMessage = payload.templateId
      ? {
          messaging_product: 'whatsapp',
          recipient_type:    'individual',
          to:                phone,
          type:              'template',
          template: {
            name:     payload.templateId,
            language: { code: (payload.metadata['locale'] as string) ?? 'en_IN' },
            components: [{
              type: 'body',
              parameters: [{ type: 'text', text: payload.body }],
            }],
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type:    'individual',
          to:                phone,
          type:              'text',
          text: { preview_url: false, body: payload.body },
        };

    logger.info(
      {
        channel:        'WHATSAPP',
        notificationId: payload.notificationId,
        trackingId:     payload.trackingId,
        to:             phone.replace(/\d{6}$/, '******'),
        messageType:    waMessage.type,
        templateId:     payload.templateId,
      },
      'WhatsApp sandbox: sending message',
    );

    await this.simulateNetworkDelay(80, 400);

    // Simulate 4% failure (phone not on WhatsApp)
    if (Math.random() < 0.04) {
      throw new Error('WhatsApp provider: recipient phone number not registered (sandbox)');
    }

    const providerMessageId = `wamid_${uuidv4().replace(/-/g, '').substring(0, 24)}`;

    logger.info(
      {
        channel:           'WHATSAPP',
        notificationId:    payload.notificationId,
        providerMessageId,
      },
      'WhatsApp sandbox: message accepted',
    );

    return {
      success:           true,
      providerMessageId,
      latencyMs:         0,
    };
  }

  async getStatus(providerMessageId: string): Promise<StatusResult> {
    await this.simulateNetworkDelay(30, 80);
    return {
      providerMessageId,
      status:      'DELIVERED',
      deliveredAt: new Date(Date.now() - 3000),
    };
  }

  private normalizePhone(phone: string): string {
    // Ensure E.164 format for WhatsApp
    const digits = phone.replace(/\D/g, '');
    return digits.startsWith('91') ? digits : `91${digits}`;
  }

  private simulateNetworkDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    return new Promise(r => setTimeout(r, delay));
  }
}
