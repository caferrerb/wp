import { Request, Response } from 'express';
import { EventService } from '../../services/event.service.js';

export class EventController {
  constructor(private eventService: EventService) {}

  getEvents = async (req: Request, res: Response): Promise<void> => {
    try {
      const { page, limit, event_type, remote_jid, from, to } = req.query;

      const filter = {
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? Math.min(parseInt(limit as string, 10), 100) : 50,
        event_type: event_type as string | undefined,
        remote_jid: remote_jid as string | undefined,
        from: from as string | undefined,
        to: to as string | undefined,
      };

      const result = this.eventService.getEvents(filter);

      res.json({
        success: true,
        data: result.events,
        pagination: {
          page: filter.page,
          limit: filter.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / filter.limit),
        },
      });
    } catch (error) {
      console.error('Error getting events:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  getEventTypes = async (_req: Request, res: Response): Promise<void> => {
    try {
      const types = this.eventService.getEventTypes();
      res.json({
        success: true,
        data: types,
      });
    } catch (error) {
      console.error('Error getting event types:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  getEventsToday = async (_req: Request, res: Response): Promise<void> => {
    try {
      const events = this.eventService.getEventsToday();
      res.json({
        success: true,
        data: events,
        count: events.length,
      });
    } catch (error) {
      console.error('Error getting today events:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  getEventById = async (req: Request, res: Response): Promise<void> => {
    try {
      const idParam = req.params.id as string;
      const id = parseInt(idParam, 10);
      const event = this.eventService.getEventById(id);

      if (!event) {
        res.status(404).json({ success: false, error: 'Event not found' });
        return;
      }

      res.json({
        success: true,
        data: event,
      });
    } catch (error) {
      console.error('Error getting event by id:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}
