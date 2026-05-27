import { Injectable, Logger } from '@nestjs/common';
import { WikipediaService } from '../wikipedia/wikipedia.service';

/**
 * Enriched POI response with Wikipedia content
 */
export interface EnrichResult {
  name: string;
  category: string;
  summary: string;
  url: string;
}

/**
 * Tourist-relevant POI categories
 */
const TOURISM_CATEGORIES = [
  'tourist_attraction',
  'museum',
  'monument',
  'place_of_worship',
  'historic',
  'park',
];

/**
 * Keywords that indicate non-tourist content (residential, commercial, etc.)
 * Used to filter out inappropriate Wikipedia articles
 */
const EXCLUDED_KEYWORDS = [
  'railway station',
  'bus station',
  'school',
  'hospital',
  'apartment',
  'residential',
  'shopping',
  'mall',
  'office',
  'company',
  'corporation',
  'football club',
  'soccer',
  'basketball',
  'street',
  'road',
  'avenue',
  'boulevard',
];

/**
 * POI Service - Simplified for on-demand enrichment only
 * 
 * Provides Wikipedia-based enrichment for native map POIs.
 * All responses are cached for 1 week via WikipediaService.
 */
@Injectable()
export class PoisService {
  private readonly logger = new Logger(PoisService.name);

  constructor(private readonly wikipediaService: WikipediaService) {}

  /**
   * Validate if a category represents a tourist attraction
   */
  private isTourismCategory(category: string): boolean {
    const normalized = category.toLowerCase().replace(/[\s-]/g, '_');
    return TOURISM_CATEGORIES.some(
      (c) => normalized.includes(c) || c.includes(normalized),
    );
  }

  /**
   * Check if the POI name contains excluded keywords
   */
  private containsExcludedKeywords(name: string): boolean {
    const nameLower = name.toLowerCase();
    return EXCLUDED_KEYWORDS.some((kw) => nameLower.includes(kw));
  }

  /**
   * Sanitize POI name for cache key generation
   */
  private sanitizeName(name: string): string {
    return name.trim().toLowerCase();
  }

  /**
   * Enrich a POI by coordinates with Wikipedia content
   * 
   * Strategy:
   * 1. Use Wikipedia GeoSearch API to find nearby articles within 50m radius
   * 2. Filter for tourist-relevant content
   * 3. Return the closest tourist POI with enriched content
   * 
   * Caching: Responses cached for 1 week based on rounded coordinates
   * 
   * @param lat - Latitude of clicked location
   * @param lng - Longitude of clicked location
   * @returns Enriched content or null if no tourist POI found
   */
  async enrichPoiByCoordinates(
    lat: number,
    lng: number,
  ): Promise<EnrichResult | null> {
    this.logger.debug(`Enriching POI by coordinates: [${lat}, ${lng}]`);

    try {
      // Search Wikipedia for nearby articles (50m radius)
      const nearbyArticles = await this.wikipediaService.geoSearchPois(
        lat,
        lng,
        50, // 50 meter radius for clicked location
        10, // Max 10 results
      );

      if (nearbyArticles.length === 0) {
        this.logger.debug(`No Wikipedia articles found near [${lat}, ${lng}]`);
        return null;
      }

      // Filter out non-tourist content
      const touristArticles = nearbyArticles.filter(
        (article) => !this.containsExcludedKeywords(article.title),
      );

      if (touristArticles.length === 0) {
        this.logger.debug(`No tourist-relevant articles found`);
        return null;
      }

      // Get the closest article
      const closestArticle = touristArticles[0];
      this.logger.debug(`Found closest POI: "${closestArticle.title}"`);

      // Fetch full Wikipedia content
      const summary = await this.wikipediaService.searchGlobalWikipedia(
        closestArticle.title,
      );

      if (!summary) {
        this.logger.debug(`No Wikipedia summary found for "${closestArticle.title}"`);
        return null;
      }

      // Validation: Ensure summary has meaningful content (>50 chars)
      if (summary.summary.length < 50) {
        this.logger.debug(
          `Rejected: Summary too short (${summary.summary.length} chars)`,
        );
        return null;
      }

      this.logger.log(`Successfully enriched POI: "${closestArticle.title}"`);

      return {
        name: closestArticle.title,
        category: 'tourist_attraction',
        summary: summary.summary,
        url: summary.url,
      };
    } catch (error) {
      this.logger.error(
        `Error enriching coordinates [${lat}, ${lng}]`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * Enrich a POI by name with Wikipedia content
   * 
   * Strategy:
   * 1. Validate category is tourism-related
   * 2. Filter out excluded keywords (residential/commercial)
   * 3. Search Wikipedia globally (English → Hebrew fallback)
   * 4. Return enriched content or null if not tourist-relevant
   * 
   * Caching: All Wikipedia responses are cached for 1 week
   * by WikipediaService using sanitized POI name as key.
   * 
   * @param name - POI name from native map (e.g., "Western Wall")
   * @param category - POI category (e.g., "tourist_attraction")
   * @returns Enriched content or null if not tourist-relevant
   */
  async enrichPoi(name: string, category: string): Promise<EnrichResult | null> {
    const sanitizedName = this.sanitizeName(name);
    
    this.logger.debug(`Enriching POI: "${name}" (category: ${category})`);

    // Validation 1: Check if category is tourism-related
    if (!this.isTourismCategory(category)) {
      this.logger.debug(`Rejected: Category "${category}" is not tourism-related`);
      return null;
    }

    // Validation 2: Filter out excluded keywords
    if (this.containsExcludedKeywords(name)) {
      this.logger.debug(`Rejected: POI name contains excluded keywords`);
      return null;
    }

    // Fetch Wikipedia content (with 1-week cache via WikipediaService)
    // searchGlobalWikipedia handles:
    // - English Wikipedia search → Hebrew interlanguage link
    // - Fallback to direct Hebrew search
    // - 1-week caching based on sanitized query
    const summary = await this.wikipediaService.searchGlobalWikipedia(sanitizedName);
    
    if (!summary) {
      this.logger.debug(`No Wikipedia content found for "${name}"`);
      return null;
    }

    // Validation 3: Ensure summary has meaningful content (>50 chars)
    if (summary.summary.length < 50) {
      this.logger.debug(`Rejected: Summary too short (${summary.summary.length} chars)`);
      return null;
    }

    this.logger.log(`Successfully enriched POI: "${name}"`);

    return {
      name,
      category,
      summary: summary.summary,
      url: summary.url,
    };
  }
}
