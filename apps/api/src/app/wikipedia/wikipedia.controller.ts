import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
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

  @Get('search')
  async searchGlobal(@Query('query') query: string) {
    if (!query || !query.trim()) {
      throw new BadRequestException('Query parameter "query" is required');
    }
    return this.wikipediaService.searchGlobalWikipedia(query.trim());
  }

  @Get('autocomplete')
  async autocomplete(
    @Query('query') query: string,
    @Query('lang') lang: string = 'en',
  ) {
    if (!query || !query.trim()) {
      return [];
    }
    return this.wikipediaService.autocomplete(query.trim(), lang || 'en');
  }

  @Get('nominatim-search')
  async nominatimSearch(
    @Query('query') query: string,
    @Query('lang') lang: string = 'en',
  ) {
    if (!query || !query.trim()) {
      return [];
    }
    return this.wikipediaService.searchNominatim(query.trim(), lang || 'en');
  }
}
