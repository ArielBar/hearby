import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PoisModule } from './pois/pois.module';
import { WikipediaModule } from './wikipedia/wikipedia.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl) {
          const store = await redisStore({
            url: redisUrl,
            ttl: 7 * 24 * 60 * 60 * 1000,
          });
          return { store } as any;
        }
        // Fallback to in-memory cache if no Redis configured
        return { ttl: 7 * 24 * 60 * 60 * 1000 };
      },
    }),
    PoisModule,
    WikipediaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
