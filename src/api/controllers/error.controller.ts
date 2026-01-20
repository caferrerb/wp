import { Request, Response } from 'express';
import { ErrorService } from '../../services/error.service.js';

export class ErrorController {
  constructor(private errorService: ErrorService) {}

  getErrors = async (req: Request, res: Response): Promise<void> => {
    try {
      const { page, limit, error_type, from, to } = req.query;

      const filter = {
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? Math.min(parseInt(limit as string, 10), 100) : 50,
        error_type: error_type as string | undefined,
        from: from as string | undefined,
        to: to as string | undefined,
      };

      const result = this.errorService.getErrors(filter);

      res.json({
        success: true,
        data: result.errors,
        pagination: {
          page: filter.page,
          limit: filter.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / filter.limit),
        },
      });
    } catch (error) {
      console.error('Error getting errors:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  getErrorTypes = async (_req: Request, res: Response): Promise<void> => {
    try {
      const types = this.errorService.getErrorTypes();
      res.json({
        success: true,
        data: types,
      });
    } catch (error) {
      console.error('Error getting error types:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  getErrorsToday = async (_req: Request, res: Response): Promise<void> => {
    try {
      const errors = this.errorService.getErrorsToday();
      res.json({
        success: true,
        data: errors,
        count: errors.length,
      });
    } catch (error) {
      console.error('Error getting today errors:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  getErrorById = async (req: Request, res: Response): Promise<void> => {
    try {
      const idParam = req.params.id as string;
      const id = parseInt(idParam, 10);
      const error = this.errorService.getErrorById(id);

      if (!error) {
        res.status(404).json({ success: false, error: 'Error not found' });
        return;
      }

      res.json({
        success: true,
        data: error,
      });
    } catch (error) {
      console.error('Error getting error by id:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}
