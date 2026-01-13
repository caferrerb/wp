import { IEmailService, SendEmailParams } from './email.interface.js';
import { config } from '../../config/env.js';

/**
 * Mailpit email service implementation for testing/development.
 * Mailpit is a local SMTP server that captures emails for testing.
 * API Documentation: https://mailpit.axllent.org/docs/api-v1/
 */
export class MailpitEmailService implements IEmailService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.email.mailpitUrl;
  }

  async sendEmail(params: SendEmailParams): Promise<void> {
    // Use Mailpit's /api/v1/send endpoint
    const response = await fetch(`${this.baseUrl}/api/v1/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        From: {
          Email: params.from,
          Name: params.fromName || params.from,
        },
        To: [
          {
            Email: params.to,
            Name: params.to,
          },
        ],
        Subject: params.subject,
        HTML: params.body,
        Text: params.textBody || '',
        Attachments: params.attachment
          ? [
              {
                Filename: params.attachment.filename,
                ContentType: params.attachment.contentType || 'application/octet-stream',
                Content: Buffer.isBuffer(params.attachment.content)
                  ? params.attachment.content.toString('base64')
                  : params.attachment.content,
              },
            ]
          : [],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mailpit send failed: ${response.status} ${errorText}`);
    }

    console.log('[Mailpit] Email sent successfully');
  }
}
