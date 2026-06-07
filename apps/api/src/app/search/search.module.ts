import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { QueryCorrectionService } from './query-correction.service';

@Module({
  controllers: [SearchController],
  providers: [SearchService, QueryCorrectionService],
  exports: [SearchService],
})
export class SearchModule {}
