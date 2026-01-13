import { IEmailService } from './email.interface.js';
import { MailerSendEmailService } from './mailersend.impl.js';
import { MailpitEmailService } from './mailpit.impl.js';
import { config } from '../../config/env.js';

/**
 * Factory function to create the appropriate email service based on configuration.
 * This makes the email provider transparent to the rest of the application.
 */
export function createEmailService(): IEmailService | null {
  const provider = config.email.provider;

  switch (provider) {
    case 'mailpit':
      console.log(`Email service: Mailpit (${config.email.mailpitUrl})`);
      return new MailpitEmailService();

    case 'mailersend':
      if (!config.email.mailerSendApiKey) {
        console.log('Email service: MailerSend (not configured - missing API key)');
        return null;
      }
      console.log('Email service: MailerSend');
      return new MailerSendEmailService();

    default:
      console.warn(`Unknown email provider: ${provider}`);
      return null;
  }
}
