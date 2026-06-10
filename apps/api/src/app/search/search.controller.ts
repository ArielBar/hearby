import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SearchService } from './search.service';
import { ApiKeyGuard } from '../common';

@Controller('search')
@UseGuards(ApiKeyGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * Proxy endpoint for Nominatim search to bypass iOS ATS restrictions
   * Supports multilingual search - queries can be in any language
   * Rate limited: 15 requests/minute per IP
   */
  @Get('nominatim')
  @Throttle({ default: { ttl: 60000, limit: 15 } })
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

  /**
   * Find nearby tourist POIs within a radius using Nominatim
   * GET /api/search/nearby?lat=...&lng=...&lang=en&radius=100
   */
  @Get('nearby')
  async nearbyPois(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('lang') lang?: string,
    @Query('radius') radius?: string,
  ) {
    if (!lat || !lng) {
      return [];
    }
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (isNaN(latitude) || isNaN(longitude)) {
      return [];
    }
    const radiusM = Math.min(parseInt(radius || '100', 10) || 100, 500);
    return this.searchService.searchNearbyPois(latitude, longitude, lang || 'en', radiusM);
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
