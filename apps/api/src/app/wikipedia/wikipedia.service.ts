import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';

export interface WikipediaSummary {
  title: string;
  summary: string;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class WikipediaService {
  private readonly logger = new Logger(WikipediaService.name);
  private readonly baseUrl = 'https://he.wikipedia.org/w/api.php';
  private readonly timeout = 5000;

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async getNearbyWikipediaSummary(
    lat: number,
    lng: number,
  ): Promise<WikipediaSummary | null> {
    const roundedLat = lat.toFixed(4);
    const roundedLng = lng.toFixed(4);
    const cacheKey = `wiki_cache_${roundedLat}_${roundedLng}`;

    try {
      // Check cache
      const cached = await this.cacheManager.get<WikipediaSummary>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for [${roundedLat}, ${roundedLng}]`);
        return cached;
      }

      // Cache miss — fetch from Wikipedia
      const pageId = await this.findNearbyPageId(lat, lng);
      if (!pageId) {
        return null;
      }

      const result = await this.fetchPageSummary(pageId);
      if (result) {
        await this.cacheManager.set(cacheKey, result, ONE_WEEK_MS);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to fetch Wikipedia summary for [${lat}, ${lng}]`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  private async findNearbyPageId(
    lat: number,
    lng: number,
  ): Promise<number | null> {
    const response = await axios.get(this.baseUrl, {
      params: {
        action: 'query',
        list: 'geosearch',
        gscoord: `${lat}|${lng}`,
        gsradius: 500,
        gslimit: 1,
        format: 'json',
      },
      timeout: this.timeout,
    });

    const geoResults = response.data?.query?.geosearch;
    if (!Array.isArray(geoResults) || geoResults.length === 0) {
      return null;
    }

    return geoResults[0].pageid ?? null;
  }

  private async fetchPageSummary(
    pageId: number,
  ): Promise<WikipediaSummary | null> {
    const response = await axios.get(this.baseUrl, {
      params: {
        action: 'query',
        prop: 'extracts',
        exintro: 1,
        explaintext: 1,
        pageids: pageId,
        format: 'json',
      },
      timeout: this.timeout,
    });

    const pages = response.data?.query?.pages;
    if (!pages || !pages[pageId]) {
      return null;
    }

    const page = pages[pageId];
    const title = page.title?.trim();
    const extract = page.extract?.trim();

    if (!title || !extract) {
      return null;
    }

    return { title, summary: extract };
  }
}
