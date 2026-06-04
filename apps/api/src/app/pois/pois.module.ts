import { Module } from '@nestjs/common';
import { PoisController } from './pois.controller';
import { PoisService } from './pois.service';
import { WikipediaModule } from '../wikipedia/wikipedia.module';
import { OpenAIModule } from '../openai/openai.module';

/**
 * POI Module - AI-powered audio guide enrichment
 * 
 * Provides coordinate-based POI enrichment with OpenAI-generated scripts
 * Endpoint: GET /api/pois/enrich?lat=X&lng=Y
 */
@Module({
  imports: [WikipediaModule, OpenAIModule],
  controllers: [PoisController],
  providers: [PoisService],
  exports: [PoisService],
})
export class PoisModule {}
