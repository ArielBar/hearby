import { Module } from '@nestjs/common';
import { PoisController } from './pois.controller';
import { PoisService } from './pois.service';
import { SearchModule } from '../search/search.module';
import { OpenAIModule } from '../openai/openai.module';

@Module({
  imports: [SearchModule, OpenAIModule],
  controllers: [PoisController],
  providers: [PoisService],
  exports: [PoisService],
})
export class PoisModule {}
