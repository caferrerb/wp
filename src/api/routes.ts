import { Router } from 'express';
import { MessageController } from './controllers/message.controller.js';

export function createRouter(controller: MessageController): Router {
  const router = Router();

  // Health check
  router.get('/health', controller.healthCheck);

  // Conversations
  router.get('/conversations', controller.getConversations);
  router.get('/latest-timestamp', controller.getLatestTimestamp);

  // Messages
  router.get('/messages', controller.getMessages);

  // Export
  router.get('/export-csv', controller.exportCsv);

  // Email report
  router.post('/send-report', controller.sendReport);
  router.post('/send-conversation', controller.sendConversationEmail);

  // WhatsApp
  router.get('/whatsapp/status', controller.getWhatsAppStatus);
  router.get('/whatsapp/qr', controller.getWhatsAppQr);
  router.post('/whatsapp/reset', controller.resetSession);

  return router;
}
