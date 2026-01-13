import { MailerSend, EmailParams, Sender, Recipient, Attachment } from 'mailersend';
import { IEmailService, SendEmailParams } from './email.interface.js';
import { config } from '../../config/env.js';

export class MailerSendEmailService implements IEmailService {
  private mailerSend: MailerSend;

  constructor() {
    this.mailerSend = new MailerSend({
      apiKey: config.email.mailerSendApiKey,
    });
  }

  async sendEmail(params: SendEmailParams): Promise<void> {
    const sender = new Sender(params.from, params.fromName || params.from);
    const recipients = [new Recipient(params.to)];

    const emailParams = new EmailParams()
      .setFrom(sender)
      .setTo(recipients)
      .setSubject(params.subject)
      .setHtml(params.body);

    if (params.textBody) {
      emailParams.setText(params.textBody);
    }

    if (params.attachment) {
      const content = Buffer.isBuffer(params.attachment.content)
        ? params.attachment.content.toString('base64')
        : params.attachment.content;

      const attachments = [
        new Attachment(content, params.attachment.filename, 'attachment'),
      ];
      emailParams.setAttachments(attachments);
    }

    await this.mailerSend.email.send(emailParams);
  }
}
