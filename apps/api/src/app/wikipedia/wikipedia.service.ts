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
    lang: string = 'en',
    limit = 8,
  ): Promise<
    { title: string; description: string; lat: number | null; lng: number | null; type: 'city' | 'poi' }[]
  > {
    try {
      // Validate and normalize language code (2-letter: en, he, es, fr, etc.)
      const languageCode = lang.toLowerCase().slice(0, 2);
      const wikipediaLang = ['en', 'he', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'ar'].includes(languageCode)
        ? languageCode
        : 'en';

      this.logger.log(`Autocomplete search: "${query}" in ${wikipediaLang} Wikipedia`);

      // Use Wikipedia OpenSearch for fast prefix-matching suggestions in specified language
      const response = await axios.get(
        `https://${wikipediaLang}.wikipedia.org/w/api.php`,
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
        `https://${wikipediaLang}.wikipedia.org/w/api.php`,
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

      // City/region keywords for type detection (multilingual)
      const cityKeywords = [
        // English
        'city', 'town', 'village', 'municipality', 'capital', 'metropolitan', 'urban', 'county', 'district', 'province', 'state', 'region', 'territory',
        // Hebrew
        'עיר', 'עירייה', 'בירה', 'מטרופולין', 'מחוז', 'מדינה', 'אזור',
        // Spanish
        'ciudad', 'municipio', 'capital', 'provincia', 'región',
        // French
        'ville', 'commune', 'capitale', 'métropole', 'région',
        // German
        'stadt', 'hauptstadt', 'bezirk', 'region',
      ];

      return results.map((r: any) => {
        const coords = coordsMap.get(r.title);
        const lowerTitle = r.title.toLowerCase();
        const lowerSnippet = (r.snippet || '').toLowerCase();
        
        // Determine type based on title and snippet keywords
        const isCity = cityKeywords.some(keyword => 
          lowerTitle.includes(keyword) || lowerSnippet.includes(keyword)
        );

        return {
          title: r.title,
          description: (r.snippet || '').replace(/<[^>]+>/g, '').slice(0, 100),
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          type: isCity ? 'city' : 'poi',
        };
      });
    } catch (error) {
      this.logger.error(`Autocomplete failed for "${query}" in ${lang}`, error);
      return [];
    }
  }

  /**
   * Search using Nominatim OpenStreetMap API (proxied through backend)
   * Provides native, multilingual worldwide search without client-side ATS issues
   */
  async searchNominatim(
    query: string,
    lang: string = 'en',
  ): Promise<
    { title: string; description: string; lat: number | null; lng: number | null; type: 'city' | 'poi' }[]
  > {
    try {
      this.logger.log(`Nominatim search: "${query}" in ${lang}`);

      // Build accept-language header with fallbacks for better multilingual support
      // Format: "primary-language,en;q=0.9,*;q=0.5"
      // This tells Nominatim: prefer {lang}, fallback to English, then anything
      const acceptLanguage = lang === 'en' 
        ? 'en,*;q=0.5' 
        : `${lang},en;q=0.9,*;q=0.5`;

      // Fetch from Nominatim OpenStreetMap API
      const response = await axios.get(
        'https://nominatim.openstreetmap.org/search',
        {
          params: {
            q: query.trim(),
            format: 'json',
            addressdetails: '1',
            namedetails: '1',  // Get name variations (name:en, name:he, etc.)
            extratags: '1',    // Get extra tags
            limit: '8',
            'accept-language': acceptLanguage,
          },
          headers: {
            'User-Agent': 'Hearby/1.0',
          },
          timeout: 8000,
        },
      );

      const results = response.data;

      if (!Array.isArray(results) || results.length === 0) {
        return [];
      }

      // City/region classification keywords
      const cityTypes = [
        'city', 'town', 'village', 'municipality', 'administrative',
        'state', 'province', 'region', 'county', 'district',
      ];

      const poiTypes = [
        'tourism', 'museum', 'monument', 'memorial', 'attraction',
        'place_of_worship', 'church', 'mosque', 'synagogue', 'temple',
        'castle', 'palace', 'fort', 'ruins', 'archaeological_site',
        'park', 'garden', 'viewpoint', 'beach', 'stadium',
      ];

      return results.map((item: any) => {
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);

        // Determine type based on OSM class and type
        const osmClass = item.class?.toLowerCase() || '';
        const osmType = item.type?.toLowerCase() || '';

        // Check if it's a POI
        const isPoi = poiTypes.some(
          (type) => osmClass.includes(type) || osmType.includes(type)
        );

        // Check if it's a city/region
        const isCity =
          osmClass === 'place' ||
          osmClass === 'boundary' ||
          cityTypes.some((type) => osmType.includes(type));

        // Prefer English name for better display
        // Check namedetails for name:en, fallback to name
        const nameDetails = item.namedetails || {};
        const englishName = nameDetails['name:en'] || nameDetails['int_name'] || nameDetails['name'];
        const title = englishName || item.name || item.display_name.split(',')[0];

        // Generate description
        const descriptionParts = item.display_name.split(',').slice(1, 3);
        const description = descriptionParts.join(',').trim();

        return {
          title,
          description,
          lat,
          lng,
          type: isPoi ? 'poi' : isCity ? 'city' : 'poi',
        };
      });
    } catch (error) {
      this.logger.error(`Nominatim search failed for "${query}"`, error);
      return [];
    }
  }

  /**
   * Reverse geocoding: Get POI name at specific coordinates
   * Uses Nominatim reverse geocoding API
   * 
   * @param lat - Latitude
   * @param lng - Longitude
   * @returns POI name and type, or null if not a tourist attraction
   */
  async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<{ name: string; type: 'city' | 'poi' } | null> {
    try {
      this.logger.log(`Reverse geocoding: [${lat}, ${lng}]`);

      // Try multiple zoom levels to find named POI
      // Zoom 18 = very precise (building level)
      // Zoom 17 = less precise (area level) - better for POIs that are polygons
      // Zoom 16 = district level
      // Zoom 15 = larger area level (needed for large parks like Park Güell)
      // Zoom 14 = neighborhood level (fallback for very large POIs)
      const zoomLevels = [18, 17, 16, 15, 14];
      let result = null;
      
      for (const zoom of zoomLevels) {
        try {
          // Fetch from Nominatim reverse geocoding API
          const response = await axios.get(
            'https://nominatim.openstreetmap.org/reverse',
            {
              params: {
                lat: lat.toString(),
                lon: lng.toString(),
                format: 'json',
                addressdetails: '1',
                namedetails: '1', // Get all name variations (name:en, name:he, etc.)
                extratags: '1', // Get extra tags like wikidata
                zoom: zoom.toString(),
              },
              headers: {
                'User-Agent': 'Hearby/1.0',
              },
              timeout: 8000,
            },
          );

          const data = response.data;
          
          // Check if we got a named POI (not just a building/house without name)
          // Skip plain roads/streets — they're never tourist-relevant and a lower
          // zoom level will return the actual landmark or neighborhood
          if (data && data.name && data.name.trim() !== '') {
            const dataClass = data.class?.toLowerCase() || '';
            const dataType = data.type?.toLowerCase() || '';
            const isPlainRoad = dataClass === 'highway' && 
              ['primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified', 'trunk', 'motorway'].includes(dataType);
            
            if (isPlainRoad) {
              this.logger.debug(`Zoom ${zoom}: Skipping road "${data.name}" (${dataClass}/${dataType})`);
              continue;
            }
            
            result = data;
            this.logger.debug(`Found POI at zoom ${zoom}: "${data.name}" (${dataClass}/${dataType})`);
            break; // Found a named POI, stop trying other zoom levels
          } else {
            this.logger.debug(
              `Zoom ${zoom}: No named POI (type: ${data?.type}, class: ${data?.class})`
            );
          }
        } catch (error) {
          this.logger.warn(`Reverse geocoding failed at zoom ${zoom}:`, error);
        }
      }

      if (!result || !result.name) {
        this.logger.debug(`No named POI found at [${lat}, ${lng}] (tried zoom levels: ${zoomLevels.join(', ')})`);
        return null;
      }

      // Extract OSM tags for classification
      const osmClass = result.class?.toLowerCase() || '';
      const osmType = result.type?.toLowerCase() || '';
      
      // FALLBACK: If we got a generic feature (plaza, path, square, street) or a
      // boundary/administrative result (neighborhood often named after a landmark),
      // try a nearby forward search to find the actual tourist POI
      const genericFeatures = ['square', 'plaza', 'footway', 'path', 'pedestrian', 'living_street', 'steps', 'cycleway'];
      const isGenericFeature = genericFeatures.includes(osmType) || 
                                (osmClass === 'highway' && !['motorway', 'trunk', 'primary', 'secondary'].includes(osmType));
      const isBoundaryAdministrative = osmClass === 'boundary' && osmType === 'administrative';
      
      if (isGenericFeature || isBoundaryAdministrative) {
        this.logger.debug(
          `Got ${isBoundaryAdministrative ? 'boundary/administrative' : 'generic feature'} "${result.name}" (${osmType}/${osmClass}), trying nearby search for tourist POI`
        );
        
        try {
          // Use the name from the result to search for actual POI landmarks nearby.
          // Use structured 'amenity' param to avoid boundary/administrative results dominating.
          const searchName = (result.name || result.namedetails?.name || '')
            .replace(/^(la|el|les|los|las|the|le|l'|de|del|di|il)\s+/i, ''); // Strip common articles
          
          const nearbySearch = await axios.get(
            'https://nominatim.openstreetmap.org/search',
            {
              params: {
                amenity: searchName,
                format: 'json',
                lat: lat.toString(),
                lon: lng.toString(),
                viewbox: `${lng - 0.005},${lat - 0.005},${lng + 0.005},${lat + 0.005}`,
                limit: '5',
                addressdetails: '1',
                namedetails: '1',
                extratags: '1',
              },
              headers: {
                'User-Agent': 'Hearby/1.0',
              },
              timeout: 8000,
            },
          );
          
          // Find the first tourist-relevant result
          if (nearbySearch.data && nearbySearch.data.length > 0) {
            for (const nearby of nearbySearch.data) {
              const nearbyClass = nearby.class?.toLowerCase() || '';
              const nearbyType = nearby.type?.toLowerCase() || '';
              
              // Check if this is a major tourist attraction/amenity (not another boundary)
              if (
                nearbyClass === 'tourism' ||
                nearbyClass === 'amenity' && nearbyType === 'place_of_worship' ||
                nearbyClass === 'leisure' && nearbyType === 'park' ||
                nearbyClass === 'historic' ||
                nearbyType === 'attraction' ||
                nearbyType === 'museum' ||
                nearbyType === 'park'
              ) {
                this.logger.debug(`Found tourist POI via nearby search: "${nearby.name || nearby.display_name}" (${nearbyClass}/${nearbyType})`);
                result = nearby;
                break;
              }
            }
          }
        } catch (error) {
          this.logger.warn(`Nearby search failed:`, error);
          // Continue with original result
        }
      }
      
      // Re-read class/type after potential fallback replacement
      const finalOsmClass = result.class?.toLowerCase() || '';
      const finalOsmType = result.type?.toLowerCase() || '';

      // Prefer English name for better OpenAI recognition
      // Check namedetails for name:en, fallback to default name
      const nameDetails = result.namedetails || {};
      const englishName = nameDetails['name:en'] || nameDetails['int_name'] || nameDetails['name'];
      const name = englishName || result.name;

      this.logger.debug(
        `Reverse geocode result: "${name}" (original: "${result.name}") (class: ${finalOsmClass}, type: ${finalOsmType})`
      );

      // Tourist-relevant POI types (COMPREHENSIVE LIST)
      const touristTypes = [
        // Core tourism
        'tourism', 'attraction', 'museum', 'gallery', 'artwork', 'information',
        
        // Historic & cultural
        'monument', 'memorial', 'historic', 'heritage', 'yes', // 'yes' catches historic=yes
        'archaeological_site', 'ruins', 'castle', 'palace', 'fort', 'fortress',
        
        // Religious sites
        'place_of_worship', 'church', 'mosque', 'synagogue', 'temple',
        'cathedral', 'chapel', 'shrine', 'monastery', 'basilica',
        
        // Public art & landmarks
        'fountain', 'statue', 'sculpture', 'landmark', 'mural', 'street_art',
        
        // Cultural venues
        'theatre', 'theater', 'opera', 'concert_hall', 'arena',
        'events_venue', 'bullring', 'stadium', 'cinema', 'auditorium',
        
        // Markets & shopping (famous/historic)
        'marketplace', 'market', 'market_hall', 'bazaar', 'shopping',
        'mall', 'shopping_centre', 'shopping_center', 'department_store',
        'retail', 'commercial', // Large commercial centers
        
        // Entertainment & leisure
        'casino', 'nightclub', 'club', // Entertainment venues
        'sports_centre', 'fitness', 'recreation', // Recreation centers
        
        // Scenic spots & nature
        'viewpoint', 'observation', 'panoramic', 'lookout',
        'beach', 'bay', 'coast', 'waterfront', 'promenade',
        'park', 'garden', 'botanical_garden', 'national_park',
        'zoo', 'aquarium', 'wildlife', 'nature_reserve',
        'waterfall', 'geyser', 'hot_spring', 'spring',
        'lake', 'river', 'stream', 'pond', 'wetland',
        'mountain', 'peak', 'hill', 'volcano', 'cliff', 'rock',
        'cave', 'glacier', 'valley',
        
        // Transportation landmarks (historic/architectural)
        'bridge', 'gate', 'tower', 'lighthouse', 'pier', 'harbor',
        'aqueduct', 'viaduct',
        
        // Famous streets & squares
        'pedestrian', 'footway', 'steps', // Pedestrian streets, stairs (e.g., Spanish Steps)
        'square', 'plaza', 'piazza', // Famous squares
        
        // Historic buildings & districts
        'building', 'townhall', 'city_hall', 'courthouse',
        'library', 'university', 'college', // Historic campuses
        'neighbourhood', 'quarter', 'district', // Historic districts
        
        // Unusual tourist attractions
        'cemetery', 'grave_yard', // Famous cemeteries (e.g., Père Lachaise)
        'windmill', 'water_mill', 'watermill',
        'observatory', 'planetarium',
        'theme_park', 'amusement',
        'spa', 'hot_spring', 'thermal',
        
        // Food & dining (famous restaurants, cafes)
        'restaurant', 'cafe', 'bar', 'pub', 'food_court',
        'fast_food', 'ice_cream', 'bakery',
        
        // Accommodation (famous hotels)
        'hotel', 'hostel', 'resort', 'guest_house',
        
        // Transportation (famous stations, airports)
        'aerodrome', 'airport', 'heliport',
        'ferry_terminal', 'taxi',
      ];

      // Non-tourist types (exclude these - minimal list)
      // Note: We're now very permissive - most named places are considered tourist-relevant
      const excludedTypes = [
        'office', 'residential', 'apartment', 'house',
        'school', 'hospital', 'clinic',
        'parking', 'fuel', 'atm', 'bank', 'post_office', 'pharmacy',
        'road', 'street', 'path',
        'railway', 'station', 'bus_stop',
      ];

      // Check if it's a tourist attraction
      const isTourist = touristTypes.some(
        (type) => finalOsmClass.includes(type) || finalOsmType.includes(type)
      );

      // Check if it's excluded
      const isExcluded = excludedTypes.some(
        (type) => finalOsmClass.includes(type) || finalOsmType.includes(type)
      );

      if (isExcluded) {
        this.logger.debug(
          `Excluded non-tourist location: "${name}" (${finalOsmClass}/${finalOsmType})`
        );
        return null;
      }

      if (!isTourist) {
        // Not clearly a tourist attraction
        this.logger.debug(
          `Not a tourist attraction: "${name}" (${finalOsmClass}/${finalOsmType})`
        );
        return null;
      }

      // Determine if it's a city or POI
      const isCity = finalOsmClass === 'place' && ['city', 'town', 'village'].includes(finalOsmType);

      this.logger.log(
        `✓ Found tourist POI: "${name}" at [${lat}, ${lng}]`
      );

      return {
        name,
        type: isCity ? 'city' : 'poi',
      };
    } catch (error) {
      this.logger.error(
        `Reverse geocoding failed for [${lat}, ${lng}]`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }
}
