import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';

/**
 * Global request logging interceptor.
 * Logs structured data for every API request: timestamp, method, route,
 * status code, response time, and client IP.
 *
 * Also extracts user identity (from req.user.id or x-device-id header)
 * and attaches it to Sentry so all downstream metrics/costs are scoped to the user.
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

    // Extract user identity and attach to Sentry scope
    const userId = this.extractUserId(request);
    if (userId) {
      Sentry.setUser({ id: userId, ip_address: clientIp });
    } else {
      Sentry.setUser({ ip_address: clientIp });
    }

    // Set user context as a tag for cost/metrics filtering
    Sentry.setTag('device_id', userId || 'anonymous');

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          this.logRequest(method, originalUrl, response.statusCode, startTime, clientIp, userId);
        },
        error: (error) => {
          const statusCode = error?.status || error?.statusCode || 500;
          this.logRequest(method, originalUrl, statusCode, startTime, clientIp, userId);
        },
      }),
    );
  }

  private extractUserId(request: Request): string | null {
    // Priority 1: authenticated user (if auth middleware sets req.user)
    const reqUser = (request as any).user;
    if (reqUser?.id) {
      return String(reqUser.id);
    }

    // Priority 2: device ID header from mobile clients
    const deviceId = request.headers['x-device-id'] as string;
    if (deviceId) {
      return deviceId;
    }

    return null;
  }

  private logRequest(
    method: string,
    url: string,
    statusCode: number,
    startTime: number,
    clientIp: string,
    userId: string | null,
  ) {
    const duration = Date.now() - startTime;
    const logData = {
      timestamp: new Date().toISOString(),
      method,
      route: url,
      statusCode,
      responseTimeMs: duration,
      clientIp,
      userId: userId || 'anonymous',
    };

    if (statusCode >= 400) {
      this.logger.warn(JSON.stringify(logData));
    } else {
      this.logger.log(JSON.stringify(logData));
    }
  }
}
