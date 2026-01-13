export interface EmailAttachment {
  filename: string;
  content: Buffer | string; // Buffer or base64 string
  contentType?: string;
}

export interface SendEmailParams {
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  body: string; // HTML body
  textBody?: string;
  attachment?: EmailAttachment;
}

export interface IEmailService {
  sendEmail(params: SendEmailParams): Promise<void>;
}
