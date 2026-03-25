import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode, ErrorResponse } from '../lib/errors';

/**
 * @notice Global Express error-handling middleware.
 * @dev Mount this AFTER all routes so unhandled errors bubble up here:
 *   app.use(errorHandler);
 *
 * Behaviour:
 * - AppError instances are serialised via AppError.toResponse()
 *   and the correct HTTP status code is used.
 * - Any other thrown value is treated as an unexpected server error (500),
 *   logged, and returned as { code: 'INTERNAL_ERROR', message: 'Internal server error' }.
 * - Stack traces are never leaked to the client.
 * - If requestIdMiddleware is mounted earlier, req.requestId is forwarded
 *   in the JSON response body for traceability.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // Express requires the fourth argument for the function to be recognised
  // as an error handler, even when it is unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId: string | undefined = (req as any).requestId;

  if (err instanceof AppError) {
    const body = err.toResponse() as ErrorResponse & { requestId?: string };
    if (requestId !== undefined) body.requestId = requestId;
    res.status(err.statusCode).json(body);
    return;
  }

  // Unknown / unexpected error — log and return an opaque 500.
  console.error('[errorHandler] Unhandled error:', err);

  const body: ErrorResponse & { requestId?: string } = {
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Internal server error',
  };
  if (requestId !== undefined) body.requestId = requestId;
  res.status(500).json(body);
}