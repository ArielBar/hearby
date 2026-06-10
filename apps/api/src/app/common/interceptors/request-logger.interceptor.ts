import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';

/**
 * Global request logging interceptor.
 * Logs structured data for every API request: timestamp, method, route,
 * status code, response time, and client IP.
 */
@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startTime = Date.now();
    const request = context.switchToHttp().getRequest<Request>();
    const { method, originalUrl } = request;
    const clientIp =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.socket.remoteAddress ||
      'unknown';

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          this.logRequest(method, originalUrl, response.statusCode, startTime, clientIp);
        },
        error: (error) => {
          const statusCode = error?.status || error?.statusCode || 500;
          this.logRequest(method, originalUrl, statusCode, startTime, clientIp);
        },
      }),
    );
  }

  private logRequest(
    method: string,
    url: string,
    statusCode: number,
    startTime: number,
    clientIp: string,
  ) {
    const duration = Date.now() - startTime;
    const logData = {
      timestamp: new Date().toISOString(),
      method,
      route: url,
      statusCode,
      responseTimeMs: duration,
      clientIp,
    };

    if (statusCode >= 400) {
      this.logger.warn(JSON.stringify(logData));
    } else {
      this.logger.log(JSON.stringify(logData));
    }
  }
}
