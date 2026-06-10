import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from '@redis/client';
import { createHash } from 'crypto';
import { SearchService } from '../search/search.service';
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
const AUDIO_PREFIX = 'audio:';
const AUDIO_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
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
  private redis!: RedisClientType;

  constructor(
    private readonly searchService: SearchService,
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
      const key = `${DATA_PREFIX}${poiName}:${lang}`;
      const data = await this.redis.get(key);

      if (!data || typeof data !== 'string') {
        this.logger.debug(`Geo found "${poiName}" but no data for key "${key}"`);
        return null;
      }

      return JSON.parse(data) as EnrichResult;
    } catch (error) {
      this.logger.warn(`Geo search failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Check cache for both target language and English in a single geo query
   */
  private async findNearbyPoiWithFallback(
    lat: number,
    lng: number,
    lang: string,
  ): Promise<{ result: EnrichResult; source: 'target' | 'english' } | null> {
    try {
      const results = await this.redis.geoSearch(GEO_KEY, { longitude: lng, latitude: lat }, { radius: SEARCH_RADIUS_M, unit: 'm' }, { COUNT: 1, SORT: 'ASC' });

      if (!results || results.length === 0) {
        return null;
      }

      const poiName = results[0];

      // Check both languages in parallel with a single geo query
      const [targetData, englishData] = await Promise.all([
        this.redis.get(`${DATA_PREFIX}${poiName}:${lang}`),
        lang !== DEFAULT_LANG ? this.redis.get(`${DATA_PREFIX}${poiName}:${DEFAULT_LANG}`) : null,
      ]);

      if (targetData && typeof targetData === 'string') {
        return { result: JSON.parse(targetData), source: 'target' };
      }
      if (englishData && typeof englishData === 'string') {
        return { result: JSON.parse(englishData), source: 'english' };
      }

      return null;
    } catch (error) {
      this.logger.warn(`Geo search failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Store enriched POI in Redis with geospatial index (never expires)
   * Geo member is always the English name. Data is keyed by english name + language.
   */
  private async storePoi(
    lat: number,
    lng: number,
    englishName: string,
    result: EnrichResult,
    lang: string = DEFAULT_LANG,
  ): Promise<void> {
    try {
      // Geo member is always the English name
      await this.redis.geoAdd(GEO_KEY, {
        longitude: lng,
        latitude: lat,
        member: englishName,
      });

      // Store enrichment data keyed by English name + language
      const dataKey = `${DATA_PREFIX}${englishName}:${lang}`;
      await this.redis.set(dataKey, JSON.stringify(result));

      this.logger.log(`Stored POI "${dataKey}" at [${lat}, ${lng}]`);
    } catch (error) {
      this.logger.error(`Failed to store POI: ${error.message}`);
    }
  }

  /**
   * Enrich a POI by coordinates — checks geospatial cache first
   *
   * Flow:
   * 1. Check if translated version exists in cache → return
   * 2. Check if English base exists in cache → translate + store
   * 3. Otherwise: geocode → generate English + translated in parallel → store both
   */
  async enrichPoiByCoordinates(
    lat: number,
    lng: number,
    lang: string = DEFAULT_LANG,
  ): Promise<EnrichResult | null> {
    // Step 1: Single geo query checks both target language and English
    if (lang !== DEFAULT_LANG) {
      const cacheHit = await this.findNearbyPoiWithFallback(lat, lng, lang);
      if (cacheHit) {
        if (cacheHit.source === 'target') {
          this.logger.debug(`Geo cache hit at [${lat}, ${lng}]: "${cacheHit.result.name}" (${lang})`);
          return cacheHit.result;
        }
        // English exists, translate it
        const englishName = cacheHit.result.name;
        this.logger.log(`Translating "${englishName}" from en → ${lang}`);
        const translation = await this.openaiService.translateScript(
          cacheHit.result.masterScript,
          englishName,
          lang,
        );
        if (translation) {
          const result: EnrichResult = {
            name: translation.translatedName,
            masterScript: translation.translatedScript,
          };
          this.storePoi(lat, lng, englishName, result, lang);
          return result;
        }
        return cacheHit.result;
      }
    } else {
      const cached = await this.findNearbyPoi(lat, lng, lang);
      if (cached) {
        this.logger.debug(`Geo cache hit at [${lat}, ${lng}]: "${cached.name}" (${lang})`);
        return cached;
      }
    }

    this.logger.log(`Geo cache miss — enriching POI at [${lat}, ${lng}] (${lang})`);

    try {
      // Step 2: Reverse geocode to get POI name (Mapbox — always English)
      const poi = await this.searchService.reverseGeocode(lat, lng);

      if (!poi) {
        this.logger.debug(`No tourist POI found at [${lat}, ${lng}]`);
        return null;
      }

      const englishName = poi.name; // Canonical English name from geocoder
      this.logger.log(`✓ Identified POI: "${englishName}" at [${lat}, ${lng}]`);

      // Step 3: Generate scripts — English + target language in parallel if needed
      if (lang !== DEFAULT_LANG) {
        const [audioScript, directTranslation] = await Promise.all([
          this.openaiService.generateAudioScript(englishName),
          this.openaiService.generateAudioScript(englishName, lang),
        ]);

        // Store English base if generated (fire-and-forget)
        if (audioScript) {
          const englishResult: EnrichResult = {
            name: audioScript.name,
            masterScript: audioScript.masterScript,
          };
          this.storePoi(lat, lng, englishName, englishResult, DEFAULT_LANG);
        }

        // Return the direct translation if available
        if (directTranslation) {
          const translatedResult: EnrichResult = {
            name: directTranslation.name,
            masterScript: directTranslation.masterScript,
          };
          this.storePoi(lat, lng, englishName, translatedResult, lang);
          this.logger.log(`✓ Enriched POI "${englishName}:${lang}" at [${lat}, ${lng}]`);
          return translatedResult;
        }

        // Fallback: translate from English if direct generation failed
        if (audioScript) {
          const translation = await this.openaiService.translateScript(
            audioScript.masterScript,
            audioScript.name,
            lang,
          );
          if (translation) {
            const result: EnrichResult = {
              name: translation.translatedName,
              masterScript: translation.translatedScript,
            };
            this.storePoi(lat, lng, englishName, result, lang);
            return result;
          }
          return { name: audioScript.name, masterScript: audioScript.masterScript };
        }

        return null;
      }

      // English-only path
      const audioScript = await this.openaiService.generateAudioScript(englishName);

      if (!audioScript) {
        this.logger.warn(
          `Failed to generate audio script for "${englishName}" at [${lat}, ${lng}]`,
        );
        return null;
      }

      const englishResult: EnrichResult = {
        name: audioScript.name,
        masterScript: audioScript.masterScript,
      };
      await this.storePoi(lat, lng, englishName, englishResult, DEFAULT_LANG);

      this.logger.log(`✓ Enriched and cached POI "${englishName}:en" at [${lat}, ${lng}]`);
      return englishResult;
    } catch (error) {
      this.logger.error(
        `Error enriching coordinates [${lat}, ${lng}]`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * Get or generate TTS audio for text + language combination
   * Caches the binary audio buffer in Redis for 7 days
   */
  async getAudio(text: string, lang: string): Promise<Buffer | null> {
    const hash = createHash('md5').update(text).digest('hex');
    const cacheKey = `${AUDIO_PREFIX}${hash}:${lang}`;

    try {
      // Check Redis cache for existing audio (stored as base64)
      const cached = await this.redis.get(cacheKey);

      if (cached && typeof cached === 'string') {
        this.logger.debug(`Audio cache hit: ${cacheKey}`);
        return Buffer.from(cached, 'base64');
      }
    } catch (error) {
      this.logger.warn(`Audio cache read failed: ${error instanceof Error ? error.message : error}`);
    }

    // Cache miss — generate via OpenAI TTS
    this.logger.log(`Generating TTS audio (${lang}), text length: ${text.length}`);
    const audioBuffer = await this.openaiService.generateSpeech(text, lang);

    if (!audioBuffer) {
      return null;
    }

    // Cache in Redis as base64 with 7-day TTL
    try {
      await this.redis.set(cacheKey, audioBuffer.toString('base64'), { EX: AUDIO_TTL_SECONDS });
      this.logger.log(`Cached audio: ${cacheKey} (${audioBuffer.length} bytes)`);
    } catch (error) {
      this.logger.warn(`Audio cache write failed: ${error instanceof Error ? error.message : error}`);
    }

    return audioBuffer;
  }
}
