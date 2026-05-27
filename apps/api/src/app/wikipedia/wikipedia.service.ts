import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';

export interface WikipediaSummary {
  title: string;
  summary: string;
  url: string;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HEADERS = {
  'User-Agent': 'HearbyApp/1.0 (https://github.com/ArielBar/hearby)',
};

@Injectable()
export class WikipediaService {
  private readonly logger = new Logger(WikipediaService.name);
  private readonly timeout = 5000;

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async getSummaryByName(name: string): Promise<WikipediaSummary | null> {
    const cacheKey = `wiki_name_${name.trim().toLowerCase()}`;

    try {
      const cached = await this.cacheManager.get<WikipediaSummary>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for "${name}"`);
        return cached;
      }

      const result = await this.findAndFetchSummary(name);
      if (result) {
        await this.cacheManager.set(cacheKey, result, ONE_WEEK_MS);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to fetch Wikipedia summary for "${name}"`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * Search for POIs near the given coordinates using Wikipedia's geosearch API
   * Returns closest tourist-relevant POI within 50m radius
   */
  async searchByCoordinates(
    lat: number,
    lng: number,
    radiusMeters: number = 50,
  ): Promise<WikipediaSummary | null> {
    const cacheKey = `wiki_geo_${lat.toFixed(4)}_${lng.toFixed(4)}_${radiusMeters}`;

    try {
      const cached = await this.cacheManager.get<WikipediaSummary>(cacheKey);
      if (cached) {
        this.logger.debug(`Geo cache hit for (${lat}, ${lng})`);
        return cached;
      }

      this.logger.log(`Searching Wikipedia for POIs near (${lat}, ${lng}) within ${radiusMeters}m`);

      // Search English Wikipedia first (better global coverage)
      const response = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          list: 'geosearch',
          gscoord: `${lat}|${lng}`,
          gsradius: radiusMeters,
          gslimit: 10,
          format: 'json',
        },
        headers: HEADERS,
        timeout: this.timeout,
      });

      const results = response.data?.query?.geosearch;
      if (!Array.isArray(results) || results.length === 0) {
        this.logger.debug(`No Wikipedia POIs found within ${radiusMeters}m`);
        return null;
      }

      // Get closest POI
      const closestPoi = results[0];
      this.logger.log(`Found POI: "${closestPoi.title}" at ${closestPoi.dist}m distance`);

      // Try to get Hebrew version via interlanguage link
      const hebrewResult = await this.getHebrewFromEnglishTitle(closestPoi.title);
      
      if (hebrewResult) {
        await this.cacheManager.set(cacheKey, hebrewResult, ONE_WEEK_MS);
        return hebrewResult;
      }

      // Fallback: return English extract
      const englishExtract = await this.fetchEnglishExtractByTitle(closestPoi.title);
      if (englishExtract) {
        await this.cacheManager.set(cacheKey, englishExtract, ONE_WEEK_MS);
      }

      return englishExtract;
    } catch (error) {
      this.logger.error(
        `Failed to search Wikipedia by coordinates (${lat}, ${lng})`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * Global text search: searches English Wikipedia first (better for global queries),
   * tries Hebrew interlanguage link, falls back to direct Hebrew search.
   * Returns the full extract for the top result, cached for 1 week.
   */
  async searchGlobalWikipedia(query: string): Promise<WikipediaSummary | null> {
    const cacheKey = `wiki_search_cache_${query.trim().toLowerCase()}`;

    try {
      const cached = await this.cacheManager.get<WikipediaSummary>(cacheKey);
      if (cached) {
        this.logger.debug(`Search cache hit for "${query}"`);
        return cached;
      }

      // Strategy 1: English Wikipedia → Hebrew interlanguage link
      const enResult = await this.textSearch('en', query);
      if (enResult) {
        const hebrewVersion = await this.getHebrewFromEnglishTitle(enResult.title);
        if (hebrewVersion) {
          await this.cacheManager.set(cacheKey, hebrewVersion, ONE_WEEK_MS);
          return hebrewVersion;
        }

        // No Hebrew version — return English extract
        const enSummary = await this.fetchEnglishExtractByTitle(enResult.title);
        if (enSummary) {
          await this.cacheManager.set(cacheKey, enSummary, ONE_WEEK_MS);
          return enSummary;
        }
      }

      // Strategy 2: Direct Hebrew Wikipedia text search (for Hebrew queries)
      const heResult = await this.textSearch('he', query);
      if (heResult) {
        const summary = await this.fetchHebrewExtractByTitle(heResult.title);
        if (summary) {
          await this.cacheManager.set(cacheKey, summary, ONE_WEEK_MS);
          return summary;
        }
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Global search failed for "${query}"`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  private async textSearch(
    lang: 'he' | 'en',
    query: string,
  ): Promise<{ title: string; pageId: number } | null> {
    const response = await axios.get(
      `https://${lang}.wikipedia.org/w/api.php`,
      {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          srlimit: 1,
          format: 'json',
        },
        headers: HEADERS,
        timeout: this.timeout,
      },
    );

    const results = response.data?.query?.search;
    if (!Array.isArray(results) || results.length === 0) return null;

    return { title: results[0].title, pageId: results[0].pageid };
  }

  private async getHebrewFromEnglishTitle(
    enTitle: string,
  ): Promise<WikipediaSummary | null> {
    const langResponse = await axios.get(
      'https://en.wikipedia.org/w/api.php',
      {
        params: {
          action: 'query',
          titles: enTitle,
          prop: 'langlinks',
          lllang: 'he',
          format: 'json',
        },
        headers: HEADERS,
        timeout: this.timeout,
      },
    );

    const pages = langResponse.data?.query?.pages;
    const page = pages ? (Object.values(pages)[0] as any) : null;
    const heTitle = page?.langlinks?.[0]?.['*'];

    if (!heTitle) return null;
    return this.fetchHebrewExtractByTitle(heTitle);
  }

  private async findAndFetchSummary(
    name: string,
  ): Promise<WikipediaSummary | null> {
    // Strategy 1: Search English Wikipedia → get Hebrew interlanguage link
    const hebrewFromEnglish = await this.searchEnglishThenHebrew(name);
    if (hebrewFromEnglish) return hebrewFromEnglish;

    // Strategy 2: Direct Hebrew Wikipedia search
    const hebrewDirect = await this.searchHebrew(name);
    if (hebrewDirect) return hebrewDirect;

    return null;
  }

  private async searchEnglishThenHebrew(
    name: string,
  ): Promise<WikipediaSummary | null> {
    // Search English Wikipedia
    const enResponse = await axios.get(
      'https://en.wikipedia.org/w/api.php',
      {
        params: {
          action: 'query',
          list: 'search',
          srsearch: name,
          srlimit: 1,
          format: 'json',
        },
        headers: HEADERS,
        timeout: this.timeout,
      },
    );

    const enResults = enResponse.data?.query?.search;
    if (!Array.isArray(enResults) || enResults.length === 0) return null;

    const enTitle = enResults[0].title;

    // Get Hebrew interlanguage link
    const langResponse = await axios.get(
      'https://en.wikipedia.org/w/api.php',
      {
        params: {
          action: 'query',
          titles: enTitle,
          prop: 'langlinks',
          lllang: 'he',
          format: 'json',
        },
        headers: HEADERS,
        timeout: this.timeout,
      },
    );

    const pages = langResponse.data?.query?.pages;
    const page = pages ? Object.values(pages)[0] as any : null;
    const heTitle = page?.langlinks?.[0]?.['*'];

    if (heTitle) {
      // Fetch Hebrew extract by title
      return this.fetchHebrewExtractByTitle(heTitle);
    }

    // No Hebrew version — return English extract
    return this.fetchEnglishExtractByTitle(enTitle);
  }

  private async searchHebrew(
    name: string,
  ): Promise<WikipediaSummary | null> {
    const response = await axios.get(
      'https://he.wikipedia.org/w/api.php',
      {
        params: {
          action: 'query',
          list: 'search',
          srsearch: name,
          srlimit: 1,
          format: 'json',
        },
        headers: HEADERS,
        timeout: this.timeout,
      },
    );

    const results = response.data?.query?.search;
    if (!Array.isArray(results) || results.length === 0) return null;

    return this.fetchHebrewExtractByTitle(results[0].title);
  }

  private async fetchHebrewExtractByTitle(
    title: string,
  ): Promise<WikipediaSummary | null> {
    const response = await axios.get(
      'https://he.wikipedia.org/w/api.php',
      {
        params: {
          action: 'query',
          titles: title,
          prop: 'extracts',
          exintro: 1,
          explaintext: 1,
          format: 'json',
        },
        headers: HEADERS,
        timeout: this.timeout,
      },
    );

    const pages = response.data?.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0] as any;
    const pageTitle = page?.title?.trim();
    const extract = page?.extract?.trim();

    if (!pageTitle || !extract) return null;

    return {
      title: pageTitle,
      summary: extract,
      url: `https://he.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`,
    };
  }

  private async fetchEnglishExtractByTitle(
    title: string,
  ): Promise<WikipediaSummary | null> {
    const response = await axios.get(
      'https://en.wikipedia.org/w/api.php',
      {
        params: {
          action: 'query',
          titles: title,
          prop: 'extracts',
          exintro: 1,
          explaintext: 1,
          format: 'json',
        },
        headers: HEADERS,
        timeout: this.timeout,
      },
    );

    const pages = response.data?.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0] as any;
    const pageTitle = page?.title?.trim();
    const extract = page?.extract?.trim();

    if (!pageTitle || !extract) return null;

    return {
      title: pageTitle,
      summary: extract,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`,
    };
  }

  /**
   * Discover POIs near coordinates using Wikipedia's GeoSearch API.
   * Returns articles (landmarks, places) within the given radius.
   */
  async geoSearchPois(
    lat: number,
    lng: number,
    radiusMeters: number,
    limit = 50,
  ): Promise<
    { title: string; lat: number; lng: number; pageId: number; dist: number }[]
  > {
    const clampedRadius = Math.min(radiusMeters, 10000); // Wikipedia max is 10km
    const clampedLimit = Math.min(limit, 500);

    try {
      const response = await axios.get(
        'https://en.wikipedia.org/w/api.php',
        {
          params: {
            action: 'query',
            list: 'geosearch',
            gscoord: `${lat}|${lng}`,
            gsradius: clampedRadius,
            gslimit: clampedLimit,
            format: 'json',
          },
          headers: HEADERS,
          timeout: 10000,
        },
      );

      const results = response.data?.query?.geosearch;
      if (!Array.isArray(results)) return [];

      return results.map((r: any) => ({
        title: r.title,
        lat: r.lat,
        lng: r.lon,
        pageId: r.pageid,
        dist: r.dist,
      }));
    } catch (error) {
      this.logger.error(`GeoSearch failed for [${lat}, ${lng}]`, error);
      return [];
    }
  }

  /**
   * Batch-fetch English Wikipedia extracts for multiple page IDs.
   * Returns a map of pageId → extract text.
   */
  async batchFetchExtracts(
    pageIds: number[],
  ): Promise<Map<number, string>> {
    const extractMap = new Map<number, string>();
    if (pageIds.length === 0) return extractMap;

    // Wikipedia API supports up to 50 page IDs per request
    const chunks = [];
    for (let i = 0; i < pageIds.length; i += 50) {
      chunks.push(pageIds.slice(i, i + 50));
    }

    for (const chunk of chunks) {
      try {
        const response = await axios.get(
          'https://en.wikipedia.org/w/api.php',
          {
            params: {
              action: 'query',
              pageids: chunk.join('|'),
              prop: 'extracts',
              exintro: 1,
              explaintext: 1,
              format: 'json',
            },
            headers: HEADERS,
            timeout: 10000,
          },
        );

        const pages = response.data?.query?.pages;
        if (pages) {
          for (const page of Object.values(pages) as any[]) {
            if (page.extract?.trim()) {
              extractMap.set(page.pageid, page.extract.trim());
            }
          }
        }
      } catch (error) {
        this.logger.error('Batch extract fetch failed', error);
      }
    }

    return extractMap;
  }

  async autocomplete(
    query: string,
    limit = 8,
  ): Promise<
    { title: string; description: string; lat: number | null; lng: number | null }[]
  > {
    try {
      // Use Wikipedia OpenSearch for fast prefix-matching suggestions
      const response = await axios.get(
        'https://en.wikipedia.org/w/api.php',
        {
          params: {
            action: 'query',
            list: 'search',
            srsearch: query,
            srlimit: limit,
            srprop: 'snippet',
            format: 'json',
          },
          headers: HEADERS,
          timeout: 8000,
        },
      );

      const results = response.data?.query?.search;
      if (!Array.isArray(results) || results.length === 0) return [];

      // Fetch coordinates for all results in parallel
      const titles = results.map((r: any) => r.title);
      const coordsResponse = await axios.get(
        'https://en.wikipedia.org/w/api.php',
        {
          params: {
            action: 'query',
            titles: titles.join('|'),
            prop: 'coordinates',
            format: 'json',
          },
          headers: HEADERS,
          timeout: 8000,
        },
      );

      const pages = coordsResponse.data?.query?.pages || {};
      const coordsMap = new Map<string, { lat: number; lng: number }>();
      for (const page of Object.values(pages) as any[]) {
        if (page.coordinates?.length > 0) {
          coordsMap.set(page.title, {
            lat: page.coordinates[0].lat,
            lng: page.coordinates[0].lon,
          });
        }
      }

      return results.map((r: any) => {
        const coords = coordsMap.get(r.title);
        return {
          title: r.title,
          description: (r.snippet || '').replace(/<[^>]+>/g, '').slice(0, 100),
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        };
      });
    } catch (error) {
      this.logger.error(`Autocomplete failed for "${query}"`, error);
      return [];
    }
  }
}
