import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from '@redis/client';
import { WikipediaService } from '../wikipedia/wikipedia.service';
import { OpenAIService } from '../openai/openai.service';

/**
 * Enriched POI response with AI-generated audio script
 */
export interface EnrichResult {
  name: string;
  masterScript: string;
}

const GEO_KEY = 'poi:locations';
const DATA_PREFIX = 'poi:data:';
const DEFAULT_LANG = 'en';
const SEARCH_RADIUS_M = 50; // Match within 50 meters

/**
 * POI Service - Geospatial cache with AI enrichment
 *
 * Uses Redis GEO commands for spatial lookup of previously enriched POIs.
 * When a user taps near a known POI (within 50m), returns cached result instantly.
 * Keys are based on POI name, so the same POI is found regardless of exact tap coordinates.
 *
 * Flow:
 * 1. GEOSEARCH Redis for cached POI within 50m radius
 * 2. If found → return cached data (instant, no API calls)
 * 3. If not → reverse geocode + OpenAI → store in Redis permanently
 */
@Injectable()
export class PoisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoisService.name);
  private redis: RedisClientType;

  constructor(
    private readonly wikipediaService: WikipediaService,
    private readonly openaiService: OpenAIService,
  ) {}

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.redis = createClient({ url: redisUrl }) as RedisClientType;

    this.redis.on('error', (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );

    await this.redis.connect();
    this.logger.log('Redis connected for POI geospatial cache ✓');
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  /**
   * Find the nearest cached POI within SEARCH_RADIUS_M meters
   */
  private async findNearbyPoi(
    lat: number,
    lng: number,
    lang: string = DEFAULT_LANG,
  ): Promise<EnrichResult | null> {
    try {
      const results = await this.redis.geoSearch(GEO_KEY, { longitude: lng, latitude: lat }, { radius: SEARCH_RADIUS_M, unit: 'm' }, { COUNT: 1, SORT: 'ASC' });

      if (!results || results.length === 0) {
        return null;
      }

      const poiName = results[0]; // English POI name used as geo member
      const data = await this.redis.get(`${DATA_PREFIX}${poiName}:${lang}`);

      if (!data || typeof data !== 'string') {
        return null;
      }

      return JSON.parse(data) as EnrichResult;
    } catch (error) {
      this.logger.warn(`Geo search failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Store enriched POI in Redis with geospatial index (never expires)
   */
  private async storePoi(
    lat: number,
    lng: number,
    result: EnrichResult,
    lang: string = DEFAULT_LANG,
  ): Promise<void> {
    try {
      const memberKey = result.name; // Always English name

      // Store coordinates in geo set (for spatial queries)
      await this.redis.geoAdd(GEO_KEY, {
        longitude: lng,
        latitude: lat,
        member: memberKey,
      });

      // Store enrichment data keyed by language (never expires)
      await this.redis.set(
        `${DATA_PREFIX}${memberKey}:${lang}`,
        JSON.stringify(result),
      );

      this.logger.debug(`Stored POI "${memberKey}:${lang}" at [${lat}, ${lng}]`);
    } catch (error) {
      this.logger.error(`Failed to store POI: ${error.message}`);
    }
  }

  /**
   * Enrich a POI by coordinates — checks geospatial cache first
   */
  async enrichPoiByCoordinates(
    lat: number,
    lng: number,
    lang: string = DEFAULT_LANG,
  ): Promise<EnrichResult | null> {
    // Step 1: Check if a known POI exists within 50m (in requested language)
    const cached = await this.findNearbyPoi(lat, lng, lang);
    if (cached) {
      this.logger.debug(`Geo cache hit at [${lat}, ${lng}]: "${cached.name}" (${lang})`);
      return cached;
    }

    this.logger.log(`Geo cache miss — enriching POI at [${lat}, ${lng}] (${lang})`);

    try {
      // Step 2: Reverse geocode to get POI name (Nominatim)
      const poi = await this.wikipediaService.reverseGeocode(lat, lng);

      if (!poi) {
        this.logger.debug(`No tourist POI found at [${lat}, ${lng}]`);
        return null;
      }

      this.logger.log(`✓ Identified POI: "${poi.name}" at [${lat}, ${lng}]`);

      // Step 3: Generate AI script (OpenAI) — always in English for now
      const audioScript = await this.openaiService.generateAudioScript(
        poi.name,
      );

      if (!audioScript) {
        this.logger.warn(
          `Failed to generate audio script for "${poi.name}" at [${lat}, ${lng}]`,
        );
        return null;
      }

      const result: EnrichResult = {
        name: audioScript.name,
        masterScript: audioScript.masterScript,
      };

      // Step 4: Store permanently in geospatial cache (with language)
      await this.storePoi(lat, lng, result, lang);

      this.logger.log(
        `✓ Enriched and cached POI "${result.name}:${lang}" at [${lat}, ${lng}]`,
      );

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
