import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { createClient, RedisClientType } from '@redis/client';

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const OPENAI_TIMEOUT_MS = 3000;

const SYSTEM_PROMPT = `You are a localized geospatial query corrector for a world travel app.
Your job is to take an incomplete, misspelled, or phonetically typed search query and output ONLY the corrected, official name of the intended tourist landmark, city, or country.

IMPORTANT: Always output the result in ENGLISH, regardless of the input language. Nominatim (OpenStreetMap) works best with English names for worldwide search.
Examples:
- "כנסיית אישטוון" → "St. Stephen's Basilica Budapest"
- "מגדל איי" → "Eiffel Tower"
- "סגרידה פמליעה" → "Sagrada Familia"
- "Barcelo" → "Barcelona"
- "콜로세움" → "Colosseum Rome"

If the query is already a correct English name, return it as-is.
CRITICAL: Return ONLY the raw corrected English string. No explanations, no markdown, no punctuation around it, no quotes.`;

/**
 * AI-powered query correction for search autocomplete.
 *
 * Intercepts raw user input before Nominatim and uses gpt-4o-mini to:
 * - Complete partial words ("מגדל איי" → "מגדל אייפל")
 * - Fix phonetic misspellings ("סגרידה פמליעה" → "סגרדה פמיליה")
 * - Normalize incomplete Latin input ("Barcelo" → "Barcelona")
 *
 * Results are cached in Redis (7-day TTL) to eliminate repeat LLM calls.
 * Graceful fallback: returns the raw query on any failure.
 */
@Injectable()
export class QueryCorrectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueryCorrectionService.name);
  private readonly openai: OpenAI;
  private redis!: RedisClientType;
  private redisReady = false;

  constructor(private readonly configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY') || 'dummy-key',
    });
  }

  async onModuleInit() {
    try {
      const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
      this.redis = createClient({ url: redisUrl }) as RedisClientType;
      this.redis.on('error', (err) =>
        this.logger.warn(`Redis error (query-correction): ${err.message}`),
      );
      await this.redis.connect();
      this.redisReady = true;
      this.logger.log('Query correction Redis cache connected ✓');
    } catch (err) {
      this.logger.warn(
        `Redis unavailable — query correction will run without cache: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => {});
  }

  /**
   * Correct and complete a search query using AI.
   * Returns the corrected string, or the original query on any failure.
   */
  async correct(query: string, lang: string): Promise<string> {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) return trimmed;

    // Skip correction for very short single-token queries (likely still typing)
    if (trimmed.length < 3 && !trimmed.includes(' ')) return trimmed;

    // 1. Check Redis cache
    const cacheKey = `correction:${trimmed.toLowerCase()}:${lang}`;
    try {
      if (this.redisReady) {
        const cached = await this.redis.get(cacheKey);
        if (cached && typeof cached === 'string') {
          this.logger.debug(`Cache hit: "${trimmed}" → "${cached}"`);
          return cached;
        }
      }
    } catch {
      // Cache miss or Redis down — continue to LLM
    }

    // 2. Call OpenAI gpt-4o-mini with strict timeout
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.debug('No OPENAI_API_KEY — skipping query correction');
      return trimmed;
    }

    try {
      const langLabel = this.getLangLabel(lang);

      const completion = await Promise.race([
        this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0,
          max_tokens: 80,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Query: "${trimmed}"\nLanguage: ${langLabel} (${lang})`,
            },
          ],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), OPENAI_TIMEOUT_MS),
        ),
      ]);

      const corrected = completion.choices[0]?.message?.content?.trim();

      if (!corrected) {
        this.logger.debug(`Empty AI response for "${trimmed}" — using raw query`);
        return trimmed;
      }

      this.logger.log(`Corrected: "${trimmed}" → "${corrected}" (${lang})`);

      // 3. Cache the result
      try {
        if (this.redisReady) {
          await this.redis.set(cacheKey, corrected, { EX: CACHE_TTL_SECONDS });
        }
      } catch {
        // Non-critical — correction still works without cache
      }

      return corrected;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Query correction failed (fallback to raw): ${msg}`);
      return trimmed;
    }
  }

  private getLangLabel(code: string): string {
    const map: Record<string, string> = {
      he: 'Hebrew', ar: 'Arabic', en: 'English', es: 'Spanish',
      fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
      ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
      nl: 'Dutch', tr: 'Turkish', pl: 'Polish', sv: 'Swedish',
      th: 'Thai', hi: 'Hindi',
    };
    return map[code] || code;
  }
}
