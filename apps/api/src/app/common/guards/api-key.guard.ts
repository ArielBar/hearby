import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * HMAC Signature Guard — verifies time-based signed requests.
 *
 * The mobile app signs each request with:
 *   X-Hearby-Timestamp: unix timestamp (seconds)
 *   X-Hearby-Signature: HMAC-SHA256(timestamp + ":" + path, secret)
 *
 * This guard:
 *   1. Rejects requests with missing headers
 *   2. Rejects requests older than 5 minutes (replay protection)
 *   3. Recomputes the HMAC and verifies using timing-safe comparison
 *
 * Falls back to legacy static key check (X-Hearby-API-Key) during migration.
 */
const MAX_AGE_SECONDS = 300; // 5 minutes

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly secret: string;
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly configService: ConfigService) {
    this.secret =
      this.configService.get<string>('HEARBY_HMAC_SECRET') || '';
  }

  canActivate(context: ExecutionContext): boolean {
    // Skip in development if no secret is configured
    if (!this.secret) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    const timestamp = request.headers['x-hearby-timestamp'] as string;
    const signature = request.headers['x-hearby-signature'] as string;

    if (!timestamp || !signature) {
      throw new UnauthorizedException('Missing authentication headers');
    }

    return this.verifyHmac(request, timestamp, signature);
  }

  private verifyHmac(
    request: Request,
    timestamp: string,
    signature: string,
  ): boolean {
    // Replay protection: reject requests older than MAX_AGE_SECONDS
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);

    if (isNaN(requestTime) || Math.abs(now - requestTime) > MAX_AGE_SECONDS) {
      this.logger.warn(
        `Rejected stale request: age=${now - requestTime}s, path=${request.path}`,
      );
      throw new UnauthorizedException('Request expired');
    }

    // Reconstruct the expected signature
    const path = request.path.replace(/^\/api/, ''); // normalize path
    const message = `${timestamp}:${path}`;
    const expected = createHmac('sha256', this.secret)
      .update(message)
      .digest('hex');

    // Timing-safe comparison to prevent timing attacks
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      this.logger.warn(`Invalid signature for path=${request.path}`);
      throw new UnauthorizedException('Invalid signature');
    }

    return true;
  }
}
