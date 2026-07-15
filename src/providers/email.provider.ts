import { DeliveryProvider, SendPayload, SendResult, StatusResult } from '../interfaces/provider.interface';
import { logger } from '../server';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

// ─── Email Provider (Nodemailer SMTP Sandbox) ─────────────────

export class EmailProvider extends DeliveryProvider {
  readonly channelName = 'EMAIL';

  private readonly transporter: nodemailer.Transporter;

  constructor() {
    super();
    const smtpOptions: SMTPTransport.Options = {
      host:   process.env['SMTP_HOST'] ?? 'smtp.mailtrap.io',
      port:   parseInt(process.env['SMTP_PORT'] ?? '2525', 10),
      auth: {
        user: process.env['SMTP_USER'] ?? 'sandbox_user',
        pass: process.env['SMTP_PASS'] ?? 'sandbox_pass',
      },
    };
    this.transporter = nodemailer.createTransport(smtpOptions);
  }

  protected async sendImpl(payload: SendPayload): Promise<SendResult> {
    const mailOptions: nodemailer.SendMailOptions = {
      from:    process.env['EMAIL_FROM'] ?? 'noreply@notification-engine.io',
      to:      payload.recipient,
      subject: payload.subject ?? 'Notification',
      html:    this.wrapHtml(payload.body, payload.subject),
      text:    this.stripHtml(payload.body),
      headers: {
        'X-Tracking-ID':     payload.trackingId,
        'X-Notification-ID': payload.notificationId,
        'List-Unsubscribe':  `<mailto:unsubscribe@notification-engine.io?subject=unsubscribe&body=${payload.userId}>`,
      },
    };

    logger.info(
      {
        channel:        'EMAIL',
        notificationId: payload.notificationId,
        trackingId:     payload.trackingId,
        to:             payload.recipient,
        subject:        mailOptions.subject,
      },
      'Email sandbox: sending message',
    );

    // ── Sandbox simulation (skip real SMTP) ──────────────────
    await this.simulateNetworkDelay(100, 500);

    if (Math.random() < 0.03) {
      throw new Error('Email provider: SMTP connection timeout (sandbox)');
    }

    const providerMessageId = `email_${uuidv4().replace(/-/g, '').substring(0, 24)}`;

    logger.info(
      {
        channel:           'EMAIL',
        notificationId:    payload.notificationId,
        providerMessageId,
      },
      'Email sandbox: message queued for delivery',
    );

    return {
      success:           true,
      providerMessageId,
      latencyMs:         0,
    };
  }

  async getStatus(providerMessageId: string): Promise<StatusResult> {
    await this.simulateNetworkDelay(50, 150);
    return {
      providerMessageId,
      status:      'DELIVERED',
      deliveredAt: new Date(Date.now() - 5000),
    };
  }

  private wrapHtml(body: string, subject?: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject ?? 'Notification'}</title>
  <style>
    body { margin:0; padding:0; font-family: 'Inter', -apple-system, sans-serif; background:#f4f4f5; }
    .container { max-width:600px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:linear-gradient(135deg,#6366f1,#8b5cf6); padding:24px 32px; color:#fff; font-size:18px; font-weight:600; }
    .body   { padding:32px; color:#374151; font-size:15px; line-height:1.6; }
    .footer { padding:16px 32px; background:#f9fafb; border-top:1px solid #e5e7eb; font-size:12px; color:#9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">📢 ${subject ?? 'Notification Engine'}</div>
    <div class="body">${body}</div>
    <div class="footer">You are receiving this because you opted into notifications. <a href="#">Unsubscribe</a></div>
  </div>
</body>
</html>`;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  private simulateNetworkDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    return new Promise(r => setTimeout(r, delay));
  }
}
