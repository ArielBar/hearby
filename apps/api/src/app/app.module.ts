import { Module, Logger } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PoisModule } from './pois/pois.module';
import { WikipediaModule } from './wikipedia/wikipedia.module';
import { join } from 'path';

const logger = new Logger('CacheModule');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), 'apps', 'api', '.env'),
        join(process.cwd(), '.env'),
      ],
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: (): any => {
        const redisUrl = process.env.REDIS_URL;
        const ttl = 7 * 24 * 60 * 60 * 1000;
        if (redisUrl) {
          logger.log(`Connecting to Redis at ${redisUrl}...`);
          try {
            const store = new KeyvRedis(redisUrl);
            logger.log('Redis store configured ✓');
            return { stores: [store], ttl };
          } catch (error) {
            logger.error(`Redis setup failed: ${error.message}`);
            logger.warn('Falling back to in-memory cache');
            return { ttl };
          }
        }
        logger.warn('No REDIS_URL set, using in-memory cache');
        return { ttl };
      },
    }),
    PoisModule,
    WikipediaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
