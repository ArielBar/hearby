import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { WikipediaService } from '../wikipedia/wikipedia.service';
import { OpenAIService } from '../openai/openai.service';

/**
 * Enriched POI response with AI-generated audio script
 */
export interface EnrichResult {
  name: string;
  masterScript: string;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Round coordinate to ~11m precision (4 decimal places)
 * This groups nearby taps into the same cache key
 */
function roundCoord(val: number): string {
  return val.toFixed(4);
}

/**
 * POI Service - Hybrid approach for accuracy + quality
 * 
 * Process:
 * 1. Check Redis cache for previously enriched coordinates
 * 2. Reverse geocode coordinates to get exact POI name (Nominatim)
 * 3. Send POI name to OpenAI for high-quality script generation
 * 4. Store result in Redis for future lookups by any user
 * 
 * Best of both worlds: accurate location identification + AI-generated content
 */
@Injectable()
export class PoisService {
  private readonly logger = new Logger(PoisService.name);

  constructor(
    private readonly wikipediaService: WikipediaService,
    private readonly openaiService: OpenAIService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Enrich a POI by coordinates using hybrid approach with persistent cache
   */
  async enrichPoiByCoordinates(
    lat: number,
    lng: number,
  ): Promise<EnrichResult | null> {
    const cacheKey = `poi_enrich_${roundCoord(lat)}_${roundCoord(lng)}`;

    // Check cache first (shared across all users)
    const cached = await this.cacheManager.get<EnrichResult>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for POI at [${lat}, ${lng}]: "${cached.name}"`);
      return cached;
    }

    // Check if we already know there's no POI here
    const isMiss = await this.cacheManager.get(`${cacheKey}_miss`);
    if (isMiss) {
      this.logger.debug(`Known non-POI location at [${lat}, ${lng}], skipping`);
      return null;
    }

    this.logger.log(`Cache miss - enriching POI at coordinates: [${lat}, ${lng}]`);

    try {
      // Step 1: Reverse geocode to get POI name (Nominatim)
      const poi = await this.wikipediaService.reverseGeocode(lat, lng);

      if (!poi) {
        this.logger.debug(`No tourist POI found at [${lat}, ${lng}]`);
        // Cache null result too to avoid repeated lookups for non-POI locations
        await this.cacheManager.set(`${cacheKey}_miss`, true, ONE_WEEK_MS);
        return null;
      }

      this.logger.log(`✓ Identified POI: "${poi.name}" at [${lat}, ${lng}]`);

      // Step 2: Generate AI script for this POI (OpenAI)
      const audioScript = await this.openaiService.generateAudioScript(
        poi.name,
      );

      if (!audioScript) {
        this.logger.warn(
          `Failed to generate audio script for "${poi.name}" at [${lat}, ${lng}]`,
        );
        return null;
      }

      this.logger.log(
        `✓ Successfully generated audio script for "${poi.name}" at [${lat}, ${lng}]`,
      );

      const result: EnrichResult = {
        name: audioScript.name,
        masterScript: audioScript.masterScript,
      };

      // Store in cache for future lookups by any user
      await this.cacheManager.set(cacheKey, result, ONE_WEEK_MS);

      return result;
    } catch (error) {
      this.logger.error(
        `Error enriching coordinates [${lat}, ${lng}]`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}
