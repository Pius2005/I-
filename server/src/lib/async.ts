import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Forwards rejected promises to the error middleware (Express 4 needs this). */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
