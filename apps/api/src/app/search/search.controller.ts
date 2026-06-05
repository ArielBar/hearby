import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * Proxy endpoint for Nominatim search to bypass iOS ATS restrictions
   * Supports multilingual search - queries can be in any language
   */
  @Get('nominatim')
  async nominatimSearch(
    @Query('query') query: string,
    @Query('lang') lang?: string,
  ) {
    if (!query || !query.trim()) {
      return [];
    }
    
    const detectedLang = lang || this.detectLanguage(query) || 'en';
    return this.searchService.searchNominatim(query.trim(), detectedLang);
  }

  private detectLanguage(text: string): string {
    if (/[\u0590-\u05FF]/.test(text)) return 'he';
    if (/[\u0600-\u06FF]/.test(text)) return 'ar';
    if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text)) return 'ja';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
    if (/[\u0400-\u04FF]/.test(text)) return 'ru';
    if (/[\u0370-\u03FF]/.test(text)) return 'el';
    if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
    return 'en';
  }
}
