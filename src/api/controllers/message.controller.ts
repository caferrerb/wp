import { Request, Response } from 'express';
import { MessageService } from '../../services/message.service.js';
import { ExportService } from '../../services/export.service.js';
import { WhatsAppService } from '../../services/whatsapp.service.js';
import { IEmailService } from '../../services/email/email.interface.js';
import { config } from '../../config/env.js';

export class MessageController {
  constructor(
    private messageService: MessageService,
    private exportService: ExportService,
    private whatsAppService: WhatsAppService,
    private emailService: IEmailService | null
  ) {}

  getMessages = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, page, limit, remoteJid, search, sortOrder } = req.query;

      const filter = {
        from: from ? parseInt(from as string, 10) : undefined,
        to: to ? parseInt(to as string, 10) : undefined,
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? Math.min(parseInt(limit as string, 10), 100) : 50,
        remoteJid: remoteJid as string | undefined,
        searchText: search as string | undefined,
        sortOrder: (sortOrder === 'asc' || sortOrder === 'desc') ? sortOrder as 'asc' | 'desc' : undefined,
      };

      const result = this.messageService.getMessages(filter);

      res.json({
        success: true,
        data: result.messages,
        pagination: {
          page: filter.page,
          limit: filter.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / filter.limit!),
        },
        sortOrder: result.sortOrder,
      });
    } catch (error) {
      console.error('Error getting messages:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  getConversations = async (_req: Request, res: Response): Promise<void> => {
    try {
      const conversations = this.messageService.getConversations();
      res.json({
        success: true,
        data: conversations,
      });
    } catch (error) {
      console.error('Error getting conversations:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  getLatestTimestamp = async (_req: Request, res: Response): Promise<void> => {
    try {
      const timestamp = this.messageService.getLatestTimestamp();
      res.json({
        success: true,
        timestamp,
      });
    } catch (error) {
      console.error('Error getting latest timestamp:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  exportCsv = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to } = req.query;

      let csv: string;

      if (from && to) {
        csv = this.exportService.generateCsvForDateRange(
          parseInt(from as string, 10),
          parseInt(to as string, 10)
        );
      } else {
        csv = this.exportService.generateAllCsv();
      }

      const filename = `whatsapp_messages_${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  sendReport = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!this.emailService) {
        res.status(400).json({
          success: false,
          error: 'Email service not configured. Please set MAILERSEND_API_KEY.',
        });
        return;
      }

      const { to, includeAll } = req.body;
      const recipient = to || config.email.reportTo;

      if (!recipient) {
        res.status(400).json({
          success: false,
          error: 'Recipient email is required. Set EMAIL_REPORT_TO or provide "to" in request body.',
        });
        return;
      }

      const csv = includeAll
        ? this.exportService.generateAllCsv()
        : this.exportService.generateTodaysCsv();

      const today = new Date().toISOString().split('T')[0];
      const filename = `whatsapp_messages_${today}.csv`;

      await this.emailService.sendEmail({
        to: recipient,
        from: config.email.from,
        fromName: config.email.fromName,
        subject: `WhatsApp Messages Report - ${today}`,
        body: `
          <h2>WhatsApp Messages Report</h2>
          <p>Please find attached the WhatsApp messages report for ${today}.</p>
          <p>This report was generated automatically.</p>
        `,
        textBody: `WhatsApp Messages Report for ${today}. Please see the attached CSV file.`,
        attachment: {
          filename,
          content: Buffer.from(csv, 'utf-8'),
          contentType: 'text/csv',
        },
      });

      res.json({ success: true, message: `Report sent to ${recipient}` });
    } catch (error) {
      console.error('Error sending report:', error);
      res.status(500).json({ success: false, error: 'Failed to send report' });
    }
  };

  getWhatsAppStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
      const status = this.whatsAppService.getStatus();
      res.json({ success: true, status });
    } catch (error) {
      console.error('Error getting WhatsApp status:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  getWhatsAppQr = async (_req: Request, res: Response): Promise<void> => {
    try {
      const status = this.whatsAppService.getStatus();

      if (status !== 'qr_ready') {
        res.status(400).json({
          success: false,
          error: 'QR code not available',
          status,
        });
        return;
      }

      const qrDataUrl = await this.whatsAppService.getQrCodeDataUrl();

      if (!qrDataUrl) {
        res.status(400).json({ success: false, error: 'Failed to generate QR code' });
        return;
      }

      res.json({ success: true, qr: qrDataUrl });
    } catch (error) {
      console.error('Error getting QR code:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  healthCheck = async (_req: Request, res: Response): Promise<void> => {
    res.json({
      success: true,
      status: 'healthy',
      whatsapp: this.whatsAppService.getStatus(),
      timestamp: new Date().toISOString(),
    });
  };

  resetSession = async (_req: Request, res: Response): Promise<void> => {
    try {
      await this.whatsAppService.resetSession();
      res.json({ success: true, message: 'Session reset initiated. Scan QR code to reconnect.' });
    } catch (error) {
      console.error('Error resetting session:', error);
      res.status(500).json({ success: false, error: 'Failed to reset session' });
    }
  };

  sendConversationEmail = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!this.emailService) {
        res.status(400).json({
          success: false,
          error: 'Email service not configured. Please set MAILERSEND_API_KEY.',
        });
        return;
      }

      const { remoteJid, searchText } = req.body;

      if (!remoteJid) {
        res.status(400).json({
          success: false,
          error: 'remoteJid is required',
        });
        return;
      }

      const recipient = config.email.reportTo;
      if (!recipient) {
        res.status(400).json({
          success: false,
          error: 'EMAIL_REPORT_TO is not configured',
        });
        return;
      }

      // Get messages for the conversation
      const filter: { remoteJid: string; searchText?: string; limit: number } = {
        remoteJid,
        limit: 10000,
      };
      if (searchText) {
        filter.searchText = searchText;
      }

      const csv = this.exportService.generateCsvForConversation(remoteJid);
      const today = new Date().toISOString().split('T')[0];
      const contactNumber = remoteJid.split('@')[0];
      const filename = `whatsapp_${contactNumber}_${today}.csv`;

      const searchInfo = searchText ? ` (filtered by: "${searchText}")` : '';

      await this.emailService.sendEmail({
        to: recipient,
        from: config.email.from,
        fromName: config.email.fromName,
        subject: `WhatsApp Conversation Export - ${contactNumber}`,
        body: `
          <h2>WhatsApp Conversation Export</h2>
          <p>Conversation with: <strong>${contactNumber}</strong>${searchInfo}</p>
          <p>Export date: ${today}</p>
          <p>Please find the messages attached as CSV.</p>
        `,
        textBody: `WhatsApp conversation export for ${contactNumber}${searchInfo}. Date: ${today}`,
        attachment: {
          filename,
          content: Buffer.from(csv, 'utf-8'),
          contentType: 'text/csv',
        },
      });

      res.json({ success: true, message: `Conversation sent to ${recipient}` });
    } catch (error) {
      console.error('Error sending conversation email:', error);
      res.status(500).json({ success: false, error: 'Failed to send email' });
    }
  };
}
