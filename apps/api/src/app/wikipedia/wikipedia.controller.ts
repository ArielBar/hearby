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

  /**
   * Proxy endpoint for Nominatim search to bypass iOS ATS restrictions
   * Supports multilingual search - queries can be in any language
   * 
   * Examples:
   * - English: ?query=Eiffel Tower
   * - Hebrew: ?query=כיכר הבימה
   * - Arabic: ?query=المسجد الأقصى
   * - Chinese: ?query=故宫
   * - Japanese: ?query=東京タワー
   */
  @Get('nominatim-search')
  async nominatimSearch(
    @Query('query') query: string,
    @Query('lang') lang?: string,
  ) {
    if (!query || !query.trim()) {
      return [];
    }
    
    // Auto-detect language from query if not provided
    // This allows users to search in any language without specifying
    const detectedLang = lang || this.detectLanguage(query) || 'en';
    
    return this.wikipediaService.searchNominatim(query.trim(), detectedLang);
  }

  /**
   * Simple language detection based on character ranges
   * Helps Nominatim return better results by knowing the query language
   */
  private detectLanguage(text: string): string {
    // Hebrew: U+0590 to U+05FF
    if (/[\u0590-\u05FF]/.test(text)) return 'he';
    
    // Arabic: U+0600 to U+06FF
    if (/[\u0600-\u06FF]/.test(text)) return 'ar';
    
    // Chinese: U+4E00 to U+9FFF
    if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
    
    // Japanese (Hiragana, Katakana, Kanji)
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text)) return 'ja';
    
    // Korean: U+AC00 to U+D7AF
    if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
    
    // Cyrillic (Russian, etc.): U+0400 to U+04FF
    if (/[\u0400-\u04FF]/.test(text)) return 'ru';
    
    // Greek: U+0370 to U+03FF
    if (/[\u0370-\u03FF]/.test(text)) return 'el';
    
    // Thai: U+0E00 to U+0E7F
    if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
    
    // Default to English for Latin script
    return 'en';
  }
}
