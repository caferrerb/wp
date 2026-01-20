import { Router } from 'express';
import { MessageController } from './controllers/message.controller.js';
import { ErrorController } from './controllers/error.controller.js';
import { EventController } from './controllers/event.controller.js';

export function createRouter(
  controller: MessageController,
  errorController?: ErrorController,
  eventController?: EventController
): Router {
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

  // Errors
  if (errorController) {
    router.get('/errors', errorController.getErrors);
    router.get('/errors/types', errorController.getErrorTypes);
    router.get('/errors/today', errorController.getErrorsToday);
    router.get('/errors/:id', errorController.getErrorById);
  }

  // Events (message/chat deletions, etc.)
  if (eventController) {
    router.get('/events', eventController.getEvents);
    router.get('/events/types', eventController.getEventTypes);
    router.get('/events/today', eventController.getEventsToday);
    router.get('/events/:id', eventController.getEventById);
  }

  return router;
}
