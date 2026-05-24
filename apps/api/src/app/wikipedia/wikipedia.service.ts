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
}
