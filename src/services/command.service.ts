import { config } from '../config/env.js';
import { IEmailService } from './email/email.interface.js';
import { ExportService } from './export.service.js';
import { MessageService } from './message.service.js';

export interface CommandContext {
  getQrCodeDataUrl: () => Promise<string | null>;
  getStatus: () => string;
  resetSession: () => Promise<void>;
}

export interface CommandResult {
  success: boolean;
  message: string;
  shouldReply: boolean;
}

type CommandHandler = (args: string[]) => Promise<CommandResult>;

export class CommandService {
  private commands: Map<string, CommandHandler> = new Map();

  constructor(
    private emailService: IEmailService | null,
    private exportService: ExportService,
    private messageService: MessageService,
    private context: CommandContext
  ) {
    this.registerCommands();
  }

  private registerCommands(): void {
    // State command - sends health check email
    this.commands.set('state', this.handleStateCommand.bind(this));
    this.commands.set('estado', this.handleStateCommand.bind(this));
    this.commands.set('status', this.handleStateCommand.bind(this));

    // CSV command - sends CSV of supervised contacts
    this.commands.set('mail-csv', this.handleMailCsvCommand.bind(this));
    this.commands.set('csv', this.handleMailCsvCommand.bind(this));

    // QR command - sends QR code by email
    this.commands.set('qr', this.handleQrCommand.bind(this));

    // Help command
    this.commands.set('help', this.handleHelpCommand.bind(this));
    this.commands.set('ayuda', this.handleHelpCommand.bind(this));
  }

  /**
   * Check if a phone number is allowed to send commands
   */
  isCommandNumber(phoneNumber: string): boolean {
    const allowedNumbers = config.commands.allowedNumbers;
    if (allowedNumbers.length === 0) return false;

    // Remove @s.whatsapp.net or @lid suffix if present
    const cleanNumber = phoneNumber.split('@')[0];

    return allowedNumbers.some(allowed =>
      cleanNumber.includes(allowed) || allowed.includes(cleanNumber)
    );
  }

  /**
   * Parse and execute a command from a message
   */
  async executeCommand(message: string, fromNumber: string): Promise<CommandResult | null> {
    console.log(`[CMD] executeCommand called: from=${fromNumber}, msg="${message}"`);
    console.log(`[CMD] Allowed numbers:`, config.commands.allowedNumbers);
    console.log(`[CMD] isCommandNumber:`, this.isCommandNumber(fromNumber));

    if (!this.isCommandNumber(fromNumber)) {
      return null;
    }

    const trimmedMessage = message.trim().toLowerCase();

    // Check if message starts with a command prefix (optional)
    const commandText = trimmedMessage.startsWith('/')
      ? trimmedMessage.slice(1)
      : trimmedMessage;

    const parts = commandText.split(/\s+/);
    const commandName = parts[0];
    const args = parts.slice(1);

    const handler = this.commands.get(commandName);
    if (!handler) {
      return null; // Not a recognized command, treat as normal message
    }

    console.log(`[Command] Executing: ${commandName} from ${fromNumber}`);

    try {
      return await handler(args);
    } catch (error) {
      console.error(`[Command] Error executing ${commandName}:`, error);
      return {
        success: false,
        message: `Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`,
        shouldReply: true,
      };
    }
  }

  /**
   * Handle 'state' command - sends health check email
   */
  private async handleStateCommand(): Promise<CommandResult> {
    if (!this.emailService) {
      return {
        success: false,
        message: 'Email service not configured',
        shouldReply: true,
      };
    }

    const recipient = config.email.reportTo;
    if (!recipient) {
      return {
        success: false,
        message: 'EMAIL_REPORT_TO not configured',
        shouldReply: true,
      };
    }

    const status = this.context.getStatus();
    const conversations = this.messageService.getConversations();
    const totalMessages = this.messageService.getAllMessages().length;
    const todayMessages = this.messageService.getMessagesToday().length;
    const uptime = process.uptime();
    const uptimeStr = this.formatUptime(uptime);

    const statusEmoji = status === 'connected' ? '✅' : '⚠️';
    const now = new Date().toLocaleString('es-CO', { timeZone: config.email.reportTo ? 'America/Bogota' : undefined });

    await this.emailService.sendEmail({
      to: recipient,
      from: config.email.from,
      fromName: config.email.fromName,
      subject: `${statusEmoji} WhatsApp Receiver - Health Check`,
      body: `
        <h2>WhatsApp Receiver - Health Check</h2>
        <p><strong>Date:</strong> ${now}</p>

        <h3>Status</h3>
        <table style="border-collapse: collapse; width: 100%; max-width: 400px;">
          <tr style="background: #f5f5f5;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>WhatsApp Connection</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${statusEmoji} ${status}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Uptime</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${uptimeStr}</td>
          </tr>
          <tr style="background: #f5f5f5;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Conversations</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${conversations.length}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Messages</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${totalMessages}</td>
          </tr>
          <tr style="background: #f5f5f5;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Messages Today</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${todayMessages}</td>
          </tr>
        </table>

        <h3>Supervised Numbers</h3>
        <p>${config.dailyReport.filterNumbers.length > 0
          ? config.dailyReport.filterNumbers.join(', ')
          : 'None configured'}</p>

        <h3>Command Numbers</h3>
        <p>${config.commands.allowedNumbers.length > 0
          ? config.commands.allowedNumbers.join(', ')
          : 'None configured'}</p>

        <p style="color: #666; font-size: 12px; margin-top: 20px;">
          This report was triggered by WhatsApp command.
        </p>
      `,
      textBody: `WhatsApp Receiver Health Check\n\nStatus: ${status}\nUptime: ${uptimeStr}\nConversations: ${conversations.length}\nTotal Messages: ${totalMessages}\nMessages Today: ${todayMessages}`,
    });

    return {
      success: true,
      message: `✅ Health check sent to ${recipient}`,
      shouldReply: true,
    };
  }

  /**
   * Handle 'mail-csv' command - sends CSV of supervised contacts
   */
  private async handleMailCsvCommand(): Promise<CommandResult> {
    if (!this.emailService) {
      return {
        success: false,
        message: 'Email service not configured',
        shouldReply: true,
      };
    }

    const recipient = config.email.reportTo;
    if (!recipient) {
      return {
        success: false,
        message: 'EMAIL_REPORT_TO not configured',
        shouldReply: true,
      };
    }

    const filterNumbers = config.dailyReport.filterNumbers;
    const csv = filterNumbers.length > 0
      ? this.exportService.generateCsvForPhoneNumbers(filterNumbers)
      : this.exportService.generateAllCsv();

    const today = new Date().toISOString().split('T')[0];
    const filename = `whatsapp_messages_${today}.csv`;

    const description = filterNumbers.length > 0
      ? `Messages from supervised numbers: ${filterNumbers.join(', ')}`
      : 'All messages';

    await this.emailService.sendEmail({
      to: recipient,
      from: config.email.from,
      fromName: config.email.fromName,
      subject: `📊 WhatsApp Messages CSV - ${today}`,
      body: `
        <h2>WhatsApp Messages Export</h2>
        <p><strong>Date:</strong> ${today}</p>
        <p><strong>Filter:</strong> ${description}</p>
        <p>Please find the CSV file attached.</p>
        <p style="color: #666; font-size: 12px; margin-top: 20px;">
          This report was triggered by WhatsApp command.
        </p>
      `,
      textBody: `WhatsApp Messages Export\nDate: ${today}\nFilter: ${description}`,
      attachment: {
        filename,
        content: Buffer.from(csv, 'utf-8'),
        contentType: 'text/csv',
      },
    });

    return {
      success: true,
      message: `✅ CSV sent to ${recipient}`,
      shouldReply: true,
    };
  }

  /**
   * Handle 'qr' command - sends QR code by email for session reset
   */
  private async handleQrCommand(): Promise<CommandResult> {
    if (!this.emailService) {
      return {
        success: false,
        message: 'Email service not configured',
        shouldReply: true,
      };
    }

    const recipient = config.email.reportTo;
    if (!recipient) {
      return {
        success: false,
        message: 'EMAIL_REPORT_TO not configured',
        shouldReply: true,
      };
    }

    const status = this.context.getStatus();

    // If connected, need to reset session first
    if (status === 'connected') {
      await this.context.resetSession();
      // Wait a bit for new QR to be generated
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const qrDataUrl = await this.context.getQrCodeDataUrl();

    if (!qrDataUrl) {
      return {
        success: false,
        message: '⚠️ QR code not available. Current status: ' + status,
        shouldReply: true,
      };
    }

    // Extract base64 data from data URL
    const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');

    await this.emailService.sendEmail({
      to: recipient,
      from: config.email.from,
      fromName: config.email.fromName,
      subject: '🔐 WhatsApp QR Code - Scan to Connect',
      body: `
        <h2>WhatsApp QR Code</h2>
        <p>Scan this QR code with your WhatsApp app to connect:</p>
        <p><strong>WhatsApp → Settings → Linked Devices → Link a Device</strong></p>
        <div style="background: white; padding: 20px; display: inline-block; border: 1px solid #ddd; border-radius: 8px;">
          <img src="cid:qrcode" alt="QR Code" style="width: 300px; height: 300px;" />
        </div>
        <p style="color: #666; font-size: 12px; margin-top: 20px;">
          This QR code expires in a few minutes. If it expires, send the 'qr' command again.
        </p>
      `,
      textBody: 'WhatsApp QR Code - Please view this email in HTML format to see the QR code.',
      attachment: {
        filename: 'qrcode.png',
        content: Buffer.from(base64Data, 'base64'),
        contentType: 'image/png',
        cid: 'qrcode',
      },
    });

    return {
      success: true,
      message: `✅ QR code sent to ${recipient}. Check your email and scan it.`,
      shouldReply: true,
    };
  }

  /**
   * Handle 'help' command - lists available commands
   */
  private async handleHelpCommand(): Promise<CommandResult> {
    const helpText = `📋 *Available Commands*

*state* (or estado, status)
→ Sends health check email with system status

*csv* (or mail-csv)
→ Sends CSV with messages from supervised contacts

*qr*
→ Resets session and sends QR code by email

*help* (or ayuda)
→ Shows this help message`;

    return {
      success: true,
      message: helpText,
      shouldReply: true,
    };
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
  }
}
