import { Module } from '@nestjs/common';
import { PoisController } from './pois.controller';
import { PoisService } from './pois.service';
import { WikipediaModule } from '../wikipedia/wikipedia.module';

/**
 * POI Module - Simplified for on-demand enrichment only
 * 
 * Provides a single endpoint: GET /api/pois/enrich?name=X
 * No database dependencies required (pure Wikipedia enrichment)
 */
@Module({
  imports: [WikipediaModule],
  controllers: [PoisController],
  providers: [PoisService],
  exports: [PoisService],
})
export class PoisModule {}
