import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PoisModule } from './pois/pois.module';
import { WikipediaModule } from './wikipedia/wikipedia.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule.register({ isGlobal: true, ttl: 3600000 }),
    PoisModule,
    WikipediaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
