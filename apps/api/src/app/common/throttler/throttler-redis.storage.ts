import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * Redis-backed throttler storage for distributed rate limiting.
 * Connects to the hearby-redis-prod container.
 */
@Injectable()
export class ThrottlerRedisStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly redis: Redis;
  private readonly prefix = 'throttle:';

  constructor() {
    this.redis = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', {
      keyPrefix: this.prefix,
      lazyConnect: true,
    });
    this.redis.connect().catch(() => {
      // Silently fail — throttler falls back to in-memory if Redis unavailable
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `${throttlerName}:${key}`;
    const ttlSeconds = Math.ceil(ttl / 1000);

    const multi = this.redis.multi();
    multi.incr(redisKey);
    multi.pttl(redisKey);
    const results = await multi.exec();

    const totalHits = (results?.[0]?.[1] as number) || 1;
    const currentTtl = (results?.[1]?.[1] as number) || -1;

    // Set expiry only on first hit (when key was just created)
    if (currentTtl === -1 || currentTtl === -2) {
      await this.redis.expire(redisKey, ttlSeconds);
    }

    const isBlocked = totalHits > limit;
    const timeToExpire = currentTtl > 0 ? currentTtl : ttl;

    // If blocked and blockDuration specified, extend TTL
    if (isBlocked && blockDuration > 0) {
      const blockTtlSeconds = Math.ceil(blockDuration / 1000);
      await this.redis.expire(redisKey, blockTtlSeconds);
    }

    return {
      totalHits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? (blockDuration || timeToExpire) : 0,
    };
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
