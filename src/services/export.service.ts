import { Message, MessageService } from './message.service.js';

export class ExportService {
  constructor(private messageService: MessageService) {}

  generateCsv(messages: Message[]): string {
    const headers = [
      'ID',
      'Remote JID',
      'Sender Name',
      'Message ID',
      'Type',
      'Content',
      'Timestamp',
      'Is Group',
      'Created At',
    ];

    const rows = messages.map(msg => [
      msg.id.toString(),
      this.escapeCsvField(msg.remote_jid),
      this.escapeCsvField(msg.sender_name || ''),
      this.escapeCsvField(msg.message_id),
      this.escapeCsvField(msg.message_type),
      this.escapeCsvField(msg.content || ''),
      new Date(msg.timestamp * 1000).toISOString(),
      msg.is_group ? 'Yes' : 'No',
      msg.created_at,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');

    return csvContent;
  }

  generateTodaysCsv(): string {
    const messages = this.messageService.getMessagesToday();
    return this.generateCsv(messages);
  }

  generateAllCsv(): string {
    const messages = this.messageService.getAllMessages();
    return this.generateCsv(messages);
  }

  generateCsvForDateRange(from: number, to: number): string {
    const { messages } = this.messageService.getMessages({ from, to, limit: 10000 });
    return this.generateCsv(messages);
  }

  generateCsvForConversation(remoteJid: string): string {
    const { messages } = this.messageService.getMessages({ remoteJid, limit: 10000 });
    return this.generateCsv(messages);
  }

  generateCsvForPhoneNumbers(phoneNumbers: string[]): string {
    if (phoneNumbers.length === 0) {
      return this.generateTodaysCsv();
    }

    const allMessages = this.messageService.getMessagesToday();
    const filteredMessages = allMessages.filter(msg => {
      const number = msg.remote_jid.split('@')[0];
      return phoneNumbers.some(phone =>
        number.includes(phone) || phone.includes(number)
      );
    });

    return this.generateCsv(filteredMessages);
  }

  private escapeCsvField(field: string): string {
    if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }
}
