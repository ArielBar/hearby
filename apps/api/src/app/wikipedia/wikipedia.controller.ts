import { Controller, Get, Query } from '@nestjs/common';
import { WikipediaService } from './wikipedia.service';

@Controller('wikipedia')
export class WikipediaController {
  constructor(private readonly wikipediaService: WikipediaService) {}

  @Get('summary')
  async getSummary(@Query('name') name: string) {
    if (!name || !name.trim()) {
      return null;
    }
    return this.wikipediaService.getSummaryByName(name.trim());
  }
}
