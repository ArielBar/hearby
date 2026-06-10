import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PoisModule } from './pois/pois.module';
import { SearchModule } from './search/search.module';
import { ThrottlerRedisStorage } from './common';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), 'apps', 'api', `.env.${process.env['NODE_ENV'] || 'development'}`),
        join(process.cwd(), 'apps', 'api', '.env'),
        join(process.cwd(), '.env'),
      ],
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60000, // 1 minute window
          limit: 30,  // 30 requests per minute (general)
        },
      ],
      storage: new ThrottlerRedisStorage(),
    }),
    PoisModule,
    SearchModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply ThrottlerGuard globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
