import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import OpenAI from 'openai';
import { QueryCorrectionService } from './query-correction.service';

const MAPBOX_FORWARD_URL = 'https://api.mapbox.com/search/searchbox/v1/forward';
const MAPBOX_REVERSE_URL = 'https://api.mapbox.com/search/searchbox/v1/reverse';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly openai: OpenAI;
  private readonly mapboxToken: string;

  constructor(
    private readonly queryCorrection: QueryCorrectionService,
    private readonly configService: ConfigService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY') || 'dummy-key',
    });
    this.mapboxToken = this.configService.get<string>('MAPBOX_ACCESS_TOKEN') || '';
  }

  /**
   * Search for nearby tourist POIs within a radius using Overpass API
   * Overpass is purpose-built for spatial category queries, unlike Nominatim free-text search
   */
  async searchNearbyPois(
    lat: number,
    lng: number,
    lang: string = 'en',
    radiusM: number = 100,
  ): Promise<{ title: string; description: string; lat: number; lng: number }[]> {
    try {
      this.logger.log(`Nearby POI search at [${lat}, ${lng}] radius=${radiusM}m lang=${lang}`);

      // Overpass QL query: find tourism, historic, and amenity POIs within radius
      const query = `
        [out:json][timeout:10];
        (
          nwr["tourism"~"museum|attraction|monument|viewpoint|artwork|gallery|information"](around:${radiusM},${lat},${lng});
          nwr["historic"~"monument|memorial|castle|ruins|archaeological_site|fort|palace"](around:${radiusM},${lat},${lng});
          nwr["amenity"~"place_of_worship|theatre|arts_centre"](around:${radiusM},${lat},${lng});
          nwr["leisure"~"park|garden"](around:${radiusM},${lat},${lng});
        );
        out center 20;
      `;

      const response = await axios.post(
        'https://overpass-api.de/api/interpreter',
        `data=${encodeURIComponent(query)}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'HearbyApp/1.0' },
          timeout: 12000,
        },
      );

      const elements = response.data?.elements || [];
      const seen = new Set<string>();
      const pois: { title: string; description: string; lat: number; lng: number }[] = [];

      for (const el of elements) {
        // Prefer localized name, fallback to English, then default name
        const name = el.tags?.[`name:${lang}`] || el.tags?.['name:en'] || el.tags?.name;
        if (!name || seen.has(name)) continue;
        seen.add(name);

        // Get coordinates (nodes have lat/lon directly, ways/relations use center)
        const elLat = el.lat ?? el.center?.lat;
        const elLng = el.lon ?? el.center?.lon;
        if (!elLat || !elLng) continue;

        const type = el.tags?.tourism || el.tags?.historic || el.tags?.amenity || el.tags?.leisure || '';

        pois.push({
          title: name,
          description: type.replace(/_/g, ' '),
          lat: elLat,
          lng: elLng,
        });
      }

      this.logger.log(`Found ${pois.length} nearby POIs`);
      return pois.slice(0, 10);
    } catch (error) {
      this.logger.error(`Nearby POI search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Search using Mapbox Search Box API (forward)
   * Single request returns POIs with coordinates, localized names, and fuzzy matching
   * For non-Latin queries, AI correction translates to English first (Mapbox needs Latin input)
   */
  async searchNominatim(
    query: string,
    lang: string = 'en',
  ): Promise<
    { title: string; description: string; lat: number | null; lng: number | null; type: 'city' | 'poi' }[]
  > {
    try {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) return [];

      // Mapbox forward needs Latin-script queries; use AI correction for non-Latin input
      const correctedQuery = await this.queryCorrection.correct(trimmedQuery, lang);
      const finalQuery = correctedQuery || trimmedQuery;

      if (finalQuery !== trimmedQuery) {
        this.logger.log(`Mapbox search: "${trimmedQuery}" → corrected to "${finalQuery}" (${lang})`);
      } else {
        this.logger.log(`Mapbox search: "${finalQuery}" in ${lang}`);
      }

      const response = await axios.get(MAPBOX_FORWARD_URL, {
        params: {
          q: finalQuery,
          access_token: this.mapboxToken,
          language: lang === 'en' ? 'en' : `${lang},en`,
          limit: 8,
          types: 'poi,place,locality,neighborhood,address',
        },
        timeout: 8000,
      });

      const features = response.data?.features;
      if (!Array.isArray(features) || features.length === 0) {
        return [];
      }

      const cityTypes = ['place', 'locality', 'region', 'district', 'country', 'neighborhood'];

      return features.map((feature: any) => {
        // Mapbox GeoJSON: coordinates are [longitude, latitude]
        const [lng, lat] = feature.geometry?.coordinates || [null, null];
        const properties = feature.properties || {};
        const title = properties.name || properties.name_preferred || '';
        const context = properties.context || {};

        // Build localized description: prefer localized name from context objects
        const place = context.place?.name_preferred || context.place?.name
          || context.locality?.name_preferred || context.locality?.name || '';
        const country = context.country?.name_preferred || context.country?.name || '';
        const description = [place, country].filter(Boolean).join(', ') || properties.place_formatted || '';

        const featureType = properties.feature_type || '';
        const isCity = cityTypes.includes(featureType);

        return {
          title,
          description,
          lat,
          lng,
          type: isCity ? 'city' as const : 'poi' as const,
        };
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          this.logger.error('Mapbox API: Invalid access token');
        } else if (error.code === 'ECONNABORTED') {
          this.logger.error('Mapbox API: Request timed out');
        } else {
          this.logger.error(`Mapbox API error: ${error.response?.status} ${error.message}`);
        }
      } else {
        this.logger.error(`Search failed for "${query}": ${error instanceof Error ? error.message : error}`);
      }
      return [];
    }
  }

  /**
   * Reverse geocoding: Get POI name at specific coordinates
   * Uses Mapbox Geocoding API v6 reverse endpoint
   */
  async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<{ name: string; type: 'city' | 'poi' } | null> {
    try {
      this.logger.log(`Reverse geocoding: [${lat}, ${lng}]`);

      const response = await axios.get(MAPBOX_REVERSE_URL, {
        params: {
          longitude: lng,
          latitude: lat,
          access_token: this.mapboxToken,
          language: 'en',
          types: 'poi,place',
          limit: 5,
        },
        timeout: 8000,
      });

      const features = response.data?.features;
      if (!Array.isArray(features) || features.length === 0) {
        this.logger.debug(`No features found at [${lat}, ${lng}]`);
        return null;
      }

      // Prefer POI features over addresses/places
      const poiFeature = features.find(
        (f: any) => f.properties?.feature_type === 'poi',
      );
      const feature = poiFeature || features[0];
      const properties = feature.properties || {};
      const name = properties.name || properties.name_preferred || '';

      if (!name) {
        this.logger.debug(`No named feature at [${lat}, ${lng}]`);
        return null;
      }

      // Classify based on Mapbox feature_type
      const featureType = properties.feature_type || '';
      const poiCategory = (properties.poi_category || []).join(',').toLowerCase();

      // Exclude non-tourist types
      const excludedCategories = [
        'office', 'residential', 'school', 'hospital', 'clinic',
        'parking', 'fuel', 'atm', 'bank', 'post_office', 'pharmacy',
        'bus_stop', 'transit',
      ];

      if (excludedCategories.some((cat) => poiCategory.includes(cat))) {
        this.logger.debug(`Excluded non-tourist: "${name}" (${poiCategory})`);
        return null;
      }

      const isCity = featureType === 'place' || featureType === 'locality';

      this.logger.log(`✓ Found: "${name}" (${featureType}) at [${lat}, ${lng}]`);

      return {
        name,
        type: isCity ? 'city' : 'poi',
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(`Mapbox reverse geocode error: ${error.response?.status} ${error.message}`);
      } else {
        this.logger.error(
          `Reverse geocoding failed for [${lat}, ${lng}]: ${error instanceof Error ? error.message : error}`,
        );
      }
      return null;
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
