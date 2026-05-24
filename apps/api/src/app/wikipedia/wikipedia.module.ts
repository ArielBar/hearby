import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { WikipediaService } from './wikipedia.service';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Module({
  imports: [
    CacheModule.register({
      ttl: ONE_WEEK_MS,
    }),
  ],
  providers: [WikipediaService],
  exports: [WikipediaService],
})
export class WikipediaModule {}
