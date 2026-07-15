import Handlebars from 'handlebars';
import { z } from 'zod';
import { logger } from '../server';

// ─── 25+ Event Taxonomy ───────────────────────────────────────

export const EventTypeSchema = z.enum([
  // Transactional — TXNX
  'TXNX-001',  // Debit alert
  'TXNX-002',  // Credit alert
  'TXNX-003',  // Fund transfer initiated
  'TXNX-004',  // Fund transfer success
  'TXNX-005',  // Fund transfer failed
  'TXNX-006',  // Cheque bounce
  'TXNX-007',  // Auto-debit scheduled
  'TXNX-008',  // Auto-debit executed
  // SIP — SIPX
  'SIPX-001',  // SIP instalment processed
  'SIPX-002',  // SIP instalment failed
  'SIPX-003',  // SIP created
  'SIPX-004',  // SIP cancelled
  'SIPX-005',  // SIP amount changed
  // Market — MKTX
  'MKTX-001',  // Price alert triggered
  'MKTX-002',  // Portfolio daily summary
  'MKTX-003',  // Market open/close
  'MKTX-004',  // IPO allotment
  'MKTX-005',  // Dividend credited
  // Risk — RISK
  'RISK-001',  // Portfolio value drop alert
  'RISK-002',  // Margin shortfall (CRITICAL)
  'RISK-003',  // Forced liquidation warning (CRITICAL)
  'RISK-004',  // Stop-loss triggered
  // Regulatory — REGX
  'REGX-001',  // KYC expiry reminder
  'REGX-002',  // Tax filing deadline
  'REGX-003',  // ITR filing notice
  'REGX-004',  // Account statement ready
]);

export type EventType = z.infer<typeof EventTypeSchema>;

// ─── Notification Request Schema ──────────────────────────────

export const NotificationRequestSchema = z.object({
  trackingId:     z.string().uuid(),
  userId:         z.string().min(1),
  eventType:      EventTypeSchema,
  sourceEntityId: z.string().min(1),
  channels:       z.array(z.enum(['SMS', 'EMAIL', 'PUSH', 'WHATSAPP', 'INAPP'])).min(1),
  priority:       z.number().int().min(1).max(10).default(5),
  locale:         z.enum(['en', 'hi', 'mr', 'ta', 'te']).default('en'),
  personalisation: z.record(z.unknown()).default({}),
  timestamp:      z.string().datetime().default(() => new Date().toISOString()),
});

export type NotificationRequest = z.infer<typeof NotificationRequestSchema>;

// ─── Template Registry ────────────────────────────────────────

type Locale = 'en' | 'hi' | 'mr' | 'ta' | 'te';

interface TemplateEntry {
  subject: Partial<Record<Locale, string>>;
  body:    Partial<Record<Locale, string>>;
}

const TEMPLATES: Readonly<Record<string, TemplateEntry>> = {
  'TXNX-001': {
    subject: {
      en: 'Debit Alert — ₹{{formattedAmount}} deducted',
      hi: 'डेबिट अलर्ट — ₹{{formattedAmount}} काटे गए',
    },
    body: {
      en: 'Dear {{userName}}, ₹{{formattedAmount}} has been debited from your account {{accountMasked}} on {{date}}. Ref: {{txnId}}.',
      hi: 'प्रिय {{userName}}, आपके खाते {{accountMasked}} से ₹{{formattedAmount}} {{date}} को डेबिट हुए। संदर्भ: {{txnId}}।',
      mr: 'प्रिय {{userName}}, तुमच्या खाते {{accountMasked}} मधून ₹{{formattedAmount}} {{date}} रोजी डेबिट झाले. संदर्भ: {{txnId}}.',
      ta: 'அன்புள்ள {{userName}}, ₹{{formattedAmount}} உங்கள் கணக்கு {{accountMasked}} இலிருந்து {{date}} அன்று டெபிட் செய்யப்பட்டது. குறிப்பு: {{txnId}}.',
      te: 'ప్రియమైన {{userName}}, మీ ఖాతా {{accountMasked}} నుండి ₹{{formattedAmount}} {{date}} న డెబిట్ చేయబడింది. రెఫ్: {{txnId}}.',
    },
  },
  'TXNX-002': {
    subject: {
      en: 'Credit Alert — ₹{{formattedAmount}} received',
      hi: 'क्रेडिट अलर्ट — ₹{{formattedAmount}} प्राप्त हुए',
    },
    body: {
      en: 'Dear {{userName}}, ₹{{formattedAmount}} has been credited to your account {{accountMasked}} on {{date}}. Ref: {{txnId}}.',
      hi: 'प्रिय {{userName}}, ₹{{formattedAmount}} आपके खाते {{accountMasked}} में {{date}} को जमा हुए। संदर्भ: {{txnId}}।',
    },
  },
  'TXNX-003': {
    subject: { en: 'Fund Transfer Initiated — ₹{{formattedAmount}}' },
    body: {
      en: 'Dear {{userName}}, your fund transfer of ₹{{formattedAmount}} to {{beneficiaryName}} has been initiated. Expected settlement: {{settlementDate}}.',
    },
  },
  'TXNX-004': {
    subject: { en: 'Fund Transfer Successful — ₹{{formattedAmount}}' },
    body: {
      en: 'Dear {{userName}}, ₹{{formattedAmount}} has been successfully transferred to {{beneficiaryName}}. UTR: {{utrNumber}}.',
    },
  },
  'TXNX-005': {
    subject: { en: 'Fund Transfer Failed' },
    body: {
      en: 'Dear {{userName}}, your fund transfer of ₹{{formattedAmount}} to {{beneficiaryName}} has failed. Reason: {{failureReason}}. Please try again.',
    },
  },
  'TXNX-006': {
    subject: { en: 'Cheque Bounce Alert' },
    body: {
      en: 'Dear {{userName}}, your cheque no. {{chequeNumber}} for ₹{{formattedAmount}} has been returned. Reason: {{bounceReason}}. Please contact your branch.',
    },
  },
  'TXNX-007': {
    subject: { en: 'Auto-Debit Scheduled — ₹{{formattedAmount}}' },
    body: {
      en: 'Dear {{userName}}, an auto-debit of ₹{{formattedAmount}} for {{mandate}} is scheduled for {{dueDate}}. Ensure sufficient balance.',
    },
  },
  'TXNX-008': {
    subject: { en: 'Auto-Debit Executed — ₹{{formattedAmount}}' },
    body: {
      en: 'Dear {{userName}}, ₹{{formattedAmount}} has been auto-debited for {{mandate}} on {{date}}. Ref: {{txnId}}.',
    },
  },
  'SIPX-001': {
    subject: { en: 'SIP Instalment Processed — {{sipName}}' },
    body: {
      en: 'Dear {{userName}}, your SIP instalment of ₹{{formattedAmount}} in {{sipName}} (Folio: {{folioNumber}}) has been processed. NAV: {{nav}}. Units allotted: {{units}}.',
      hi: 'प्रिय {{userName}}, {{sipName}} में आपकी SIP किस्त ₹{{formattedAmount}} (फोलियो: {{folioNumber}}) की गई है। NAV: {{nav}}।',
    },
  },
  'SIPX-002': {
    subject: { en: 'SIP Instalment Failed — {{sipName}}' },
    body: {
      en: 'Dear {{userName}}, your SIP instalment of ₹{{formattedAmount}} in {{sipName}} has failed. Reason: {{failureReason}}. Please update your bank mandate.',
    },
  },
  'SIPX-003': {
    subject: { en: 'SIP Created — {{sipName}}' },
    body: {
      en: 'Dear {{userName}}, your SIP in {{sipName}} for ₹{{formattedAmount}}/month starting {{startDate}} has been created successfully. SIP ID: {{sipId}}.',
    },
  },
  'SIPX-004': {
    subject: { en: 'SIP Cancelled — {{sipName}}' },
    body: {
      en: 'Dear {{userName}}, your SIP in {{sipName}} (SIP ID: {{sipId}}) has been cancelled as requested. Last instalment date: {{lastDate}}.',
    },
  },
  'SIPX-005': {
    subject: { en: 'SIP Amount Changed — {{sipName}}' },
    body: {
      en: 'Dear {{userName}}, your SIP amount for {{sipName}} has been updated from ₹{{oldAmount}} to ₹{{formattedAmount}} effective {{effectiveDate}}.',
    },
  },
  'MKTX-001': {
    subject: { en: 'Price Alert — {{symbol}} {{direction}} ₹{{formattedPrice}}' },
    body: {
      en: 'Dear {{userName}}, {{symbol}} has {{direction}} your alert price of ₹{{formattedPrice}}. Current price: ₹{{currentPrice}}. Set at: {{alertTime}}.',
    },
  },
  'MKTX-002': {
    subject: { en: 'Your Portfolio Summary — {{date}}' },
    body: {
      en: 'Dear {{userName}}, your portfolio value today: ₹{{portfolioValue}} ({{changePercent}}% {{changeDirection}}). Top gainer: {{topGainer}}. See full report in app.',
    },
  },
  'MKTX-003': {
    subject: { en: 'Market {{action}} — {{market}}' },
    body: {
      en: 'The {{market}} market is now {{action}}. {{marketDetails}}.',
    },
  },
  'MKTX-004': {
    subject: { en: 'IPO Allotment — {{companyName}}' },
    body: {
      en: 'Dear {{userName}}, {{companyName}} IPO allotment: {{allotmentStatus}}. Shares allotted: {{sharesAllotted}}. Listing date: {{listingDate}}.',
    },
  },
  'MKTX-005': {
    subject: { en: 'Dividend Credited — {{companyName}}' },
    body: {
      en: 'Dear {{userName}}, dividend of ₹{{formattedAmount}} from {{companyName}} (₹{{dividendPerShare}}/share) has been credited to your account.',
    },
  },
  'RISK-001': {
    subject: { en: '⚠ Portfolio Alert — Value Drop' },
    body: {
      en: 'Dear {{userName}}, your portfolio has dropped by {{dropPercent}}% (₹{{dropAmount}}) today. Current value: ₹{{currentValue}}. Review your holdings.',
    },
  },
  'RISK-002': {
    subject: { en: '🚨 URGENT: Margin Shortfall — ₹{{shortfallAmount}}' },
    body: {
      en: 'URGENT: Dear {{userName}}, your account has a margin shortfall of ₹{{formattedShortfall}}. You must top up by {{deadline}} to avoid forced liquidation. Add funds immediately.',
      hi: 'अत्यावश्यक: प्रिय {{userName}}, आपके खाते में ₹{{formattedShortfall}} का मार्जिन शॉर्टफॉल है। {{deadline}} तक टॉप अप करें।',
    },
  },
  'RISK-003': {
    subject: { en: '🚨 FORCED LIQUIDATION WARNING' },
    body: {
      en: 'CRITICAL: Dear {{userName}}, forced liquidation has been initiated on your account due to margin shortfall. Positions being squared off: {{positions}}.',
    },
  },
  'RISK-004': {
    subject: { en: 'Stop-Loss Triggered — {{symbol}}' },
    body: {
      en: 'Dear {{userName}}, your stop-loss for {{symbol}} at ₹{{stopLossPrice}} has been triggered. Sold {{quantity}} shares at ₹{{executionPrice}}.',
    },
  },
  'REGX-001': {
    subject: { en: 'KYC Expiry Reminder — Action Required' },
    body: {
      en: 'Dear {{userName}}, your KYC documents expire on {{expiryDate}}. Please update your KYC before the deadline to avoid account restrictions.',
    },
  },
  'REGX-002': {
    subject: { en: 'Tax Filing Deadline — {{deadline}}' },
    body: {
      en: 'Dear {{userName}}, the last date to file your income tax return is {{deadline}}. File now to avoid penalties. Download your statement from the app.',
    },
  },
  'REGX-003': {
    subject: { en: 'ITR Filing Notice' },
    body: {
      en: 'Dear {{userName}}, you have received an Income Tax Notice for AY {{assessmentYear}}. Reference: {{noticeRef}}. Please consult your tax advisor.',
    },
  },
  'REGX-004': {
    subject: { en: 'Account Statement Ready — {{period}}' },
    body: {
      en: 'Dear {{userName}}, your account statement for {{period}} is ready. Download it from the app or check your registered email.',
    },
  },
};

// ─── Handlebars Helpers ───────────────────────────────────────

// Indian number formatting: 1,23,456.78
function formatIndianCurrency(value: number, decimals = 2): string {
  if (isNaN(value)) return '0';
  const fixed = value.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  if (!intPart) return fixed;

  const lastThree = intPart.slice(-3);
  const rest      = intPart.slice(0, -3);
  const formatted = rest
    ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree
    : lastThree;
  return decPart ? `${formatted}.${decPart}` : formatted;
}

Handlebars.registerHelper('formatCurrency', (value: unknown) => {
  return new Handlebars.SafeString('₹' + formatIndianCurrency(Number(value)));
});

Handlebars.registerHelper('formatNumber', (value: unknown) => {
  return formatIndianCurrency(Number(value), 0);
});

Handlebars.registerHelper('formatDate', (value: unknown) => {
  if (!value) return '';
  return new Date(String(value)).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
});

// ─── Renderer ─────────────────────────────────────────────────

export interface RenderResult {
  subject: string;
  body:    string;
}

export class TemplateRenderer {
  private readonly compiledCache = new Map<string, HandlebarsTemplateDelegate>();

  /**
   * Render a notification template for the given event type and locale.
   * Falls back to English if the locale variant doesn't exist.
   */
  render(
    eventType: string,
    locale:    string = 'en',
    data:      Record<string, unknown> = {},
    channel:   string = 'SMS',
  ): RenderResult {
    const entry = TEMPLATES[eventType];
    if (!entry) {
      logger.warn({ eventType }, 'Template not found; using default');
      return {
        subject: `Notification — ${eventType}`,
        body:    `You have a new notification regarding ${eventType}.`,
      };
    }

    const effectiveLocale = (locale in (entry.body ?? {})) ? locale as Locale : 'en';

    // Enrich data with pre-formatted fields
    const enrichedData = {
      ...data,
      formattedAmount:   data['amount']   ? formatIndianCurrency(Number(data['amount']))   : undefined,
      formattedPrice:    data['price']    ? formatIndianCurrency(Number(data['price']))    : undefined,
      formattedShortfall: data['shortfallAmount'] ? formatIndianCurrency(Number(data['shortfallAmount'])) : undefined,
      currentPrice:      data['currentPrice'] ? formatIndianCurrency(Number(data['currentPrice'])) : undefined,
    };

    const subjectTemplate = entry.subject?.[effectiveLocale as Locale]
      ?? entry.subject?.['en']
      ?? eventType;

    const bodyTemplate = entry.body?.[effectiveLocale as Locale]
      ?? entry.body?.['en']
      ?? 'You have a new notification.';

    const subject = this.compile(subjectTemplate)(enrichedData);
    let   body    = this.compile(bodyTemplate)(enrichedData);

    // Enforce 160-char limit for SMS
    if (channel === 'SMS' && body.length > 160) {
      body = body.substring(0, 157) + '...';
    }

    return { subject, body };
  }

  private compile(template: string): HandlebarsTemplateDelegate {
    if (!this.compiledCache.has(template)) {
      this.compiledCache.set(template, Handlebars.compile(template));
    }
    return this.compiledCache.get(template)!;
  }
}
