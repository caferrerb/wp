import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { config, validateConfig } from './config/env.js';
import { runMigrations } from './database/migrations.js';
import { closeDatabase } from './database/connection.js';
import { MessageService } from './services/message.service.js';
import { ExportService } from './services/export.service.js';
import { WhatsAppService } from './services/whatsapp.service.js';
import { CommandService } from './services/command.service.js';
import { createEmailService } from './services/email/email.factory.js';
import { MessageController } from './api/controllers/message.controller.js';
import { createRouter } from './api/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  console.log('Starting WhatsApp Message Receiver...');

  // Validate configuration
  validateConfig();

  // Initialize database
  runMigrations();

  // Initialize services
  const messageService = new MessageService();
  const exportService = new ExportService(messageService);
  const whatsAppService = new WhatsAppService(messageService);

  // Initialize email service (transparent - uses factory based on config)
  const emailService = createEmailService();

  // Initialize command service (for WhatsApp commands)
  const commandService = new CommandService(
    emailService,
    exportService,
    messageService,
    {
      getQrCodeDataUrl: () => whatsAppService.getQrCodeDataUrl(),
      getStatus: () => whatsAppService.getStatus(),
      resetSession: () => whatsAppService.resetSession(),
    }
  );
  whatsAppService.setCommandService(commandService);

  // Log command numbers if configured
  if (config.commands.allowedNumbers.length > 0) {
    console.log(`Command numbers: ${config.commands.allowedNumbers.join(', ')}`);
  }

  // Initialize Express app
  const app = express();
  app.use(express.json());

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));

  // Serve media files from data/media directory
  app.use('/media', express.static(path.join(process.cwd(), 'data', 'media')));

  // API routes
  const controller = new MessageController(
    messageService,
    exportService,
    whatsAppService,
    emailService
  );
  app.use('/api', createRouter(controller));

  // Serve index.html for root
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Start server
  const server = app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
  });

  // Initialize WhatsApp
  await whatsAppService.initialize();

  // Schedule daily report
  if (config.dailyReport.enabled && emailService) {
    const cronExpression = `${config.dailyReport.minute} ${config.dailyReport.hour} * * *`;
    const filterNumbers = config.dailyReport.filterNumbers;
    console.log(`Daily report scheduled at ${config.dailyReport.hour}:${String(config.dailyReport.minute).padStart(2, '0')}`);
    if (filterNumbers.length > 0) {
      console.log(`Daily report filter: ${filterNumbers.join(', ')}`);
    }

    cron.schedule(cronExpression, async () => {
      console.log('Running daily report job...');
      try {
        // Generate CSV filtered by phone numbers (if configured)
        const csv = exportService.generateCsvForPhoneNumbers(filterNumbers);
        const today = new Date().toISOString().split('T')[0];
        const filename = `whatsapp_messages_${today}.csv`;

        const filterInfo = filterNumbers.length > 0
          ? `Filtered by: ${filterNumbers.join(', ')}`
          : 'All messages included';

        await emailService!.sendEmail({
          to: config.email.reportTo,
          from: config.email.from,
          fromName: config.email.fromName,
          subject: `Daily WhatsApp Messages Report - ${today}`,
          body: `
            <h2>Daily WhatsApp Messages Report</h2>
            <p>Please find attached the WhatsApp messages report for ${today}.</p>
            <p><strong>${filterInfo}</strong></p>
            <p>This report was generated automatically.</p>
          `,
          textBody: `Daily WhatsApp Messages Report for ${today}. ${filterInfo}. Please see the attached CSV file.`,
          attachment: {
            filename,
            content: Buffer.from(csv, 'utf-8'),
            contentType: 'text/csv',
          },
        });
        console.log('Daily report sent successfully');
      } catch (error) {
        console.error('Error sending daily report:', error);
      }
    });
  }

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');
    server.close();
    await whatsAppService.disconnect();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
