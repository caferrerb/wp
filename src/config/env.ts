import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  whatsapp: {
    sessionPath: process.env.WA_SESSION_PATH || './wa_session',
  },

  database: {
    path: process.env.DATABASE_PATH || './data/messages.db',
  },

  email: {
    provider: (process.env.EMAIL_PROVIDER || 'mailersend') as 'mailersend' | 'mailpit',
    mailerSendApiKey: process.env.MAILERSEND_API_KEY || '',
    mailpitUrl: process.env.MAILPIT_URL || 'http://localhost:8025',
    from: process.env.EMAIL_FROM || 'noreply@localhost',
    fromName: process.env.EMAIL_FROM_NAME || 'WhatsApp Reports',
    reportTo: process.env.EMAIL_REPORT_TO || '',
  },

  dailyReport: {
    enabled: process.env.DAILY_REPORT_ENABLED === 'true',
    hour: parseInt(process.env.DAILY_REPORT_HOUR || '8', 10),
    minute: parseInt(process.env.DAILY_REPORT_MINUTE || '0', 10),
    filterNumbers: (process.env.EMAIL_FILTER_NUMBERS || '')
      .split(',')
      .map(n => n.trim())
      .filter(n => n.length > 0),
  },
};

export function validateConfig(): void {
  const errors: string[] = [];

  if (config.email.mailerSendApiKey && !config.email.from) {
    errors.push('EMAIL_FROM is required when MAILERSEND_API_KEY is set');
  }

  if (config.dailyReport.enabled && !config.email.reportTo) {
    errors.push('EMAIL_REPORT_TO is required when ENABLE_DAILY_REPORT is true');
  }

  if (errors.length > 0) {
    console.warn('Configuration warnings:');
    errors.forEach(err => console.warn(`  - ${err}`));
  }
}
