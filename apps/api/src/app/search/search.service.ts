import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const HEADERS = {
  'User-Agent': 'HearbyApp/1.0 (https://github.com/ArielBar/hearby)',
};

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly timeout = 5000;

  // Rate limiter: max 1 Nominatim request per 1.1 seconds
  private lastNominatimRequest = 0;
  private nominatimQueue: Promise<void> = Promise.resolve();

  /**
   * Ensures Nominatim requests are spaced at least 1.1s apart
   */
  private async waitForNominatimSlot(): Promise<void> {
    this.nominatimQueue = this.nominatimQueue.then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastNominatimRequest;
      if (elapsed < 1100) {
        await new Promise(r => setTimeout(r, 1100 - elapsed));
      }
      this.lastNominatimRequest = Date.now();
    });
    return this.nominatimQueue;
  }

  /**
   * Search for nearby tourist POIs within a radius using Nominatim
   */
  async searchNearbyPois(
    lat: number,
    lng: number,
    lang: string = 'en',
    radiusM: number = 100,
  ): Promise<{ title: string; description: string; lat: number; lng: number }[]> {
    try {
      this.logger.log(`Nearby POI search at [${lat}, ${lng}] radius=${radiusM}m lang=${lang}`);

      const acceptLanguage = lang === 'en'
        ? 'en,*;q=0.5'
        : `${lang},en;q=0.9,*;q=0.5`;

      // Convert radius to a viewbox (approximate degrees)
      const delta = radiusM / 111000; // ~111km per degree

      await this.waitForNominatimSlot();
      const response = await axios.get(
        'https://nominatim.openstreetmap.org/search',
        {
          params: {
            q: 'tourism',
            format: 'json',
            viewbox: `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`,
            bounded: '1',
            limit: '10',
            addressdetails: '1',
            'accept-language': acceptLanguage,
          },
          headers: { ...HEADERS, 'Accept-Language': acceptLanguage },
          timeout: 8000,
        },
      );

      const results = response.data || [];

      // Also try amenity search for places of worship, museums, etc.
      await this.waitForNominatimSlot();
      const amenityResponse = await axios.get(
        'https://nominatim.openstreetmap.org/search',
        {
          params: {
            q: 'museum OR monument OR church OR synagogue OR mosque OR castle OR palace',
            format: 'json',
            viewbox: `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`,
            bounded: '1',
            limit: '10',
            addressdetails: '1',
            'accept-language': acceptLanguage,
          },
          headers: { ...HEADERS, 'Accept-Language': acceptLanguage },
          timeout: 8000,
        },
      );

      const amenityResults = amenityResponse.data || [];

      // Merge and deduplicate by name
      const all = [...results, ...amenityResults];
      const seen = new Set<string>();
      const pois: { title: string; description: string; lat: number; lng: number }[] = [];

      for (const item of all) {
        const name = item.name || item.display_name?.split(',')[0];
        if (!name || seen.has(name)) continue;
        seen.add(name);

        const itemClass = item.class?.toLowerCase() || '';
        const itemType = item.type?.toLowerCase() || '';

        // Filter to tourist-relevant places only
        const isTourist =
          itemClass === 'tourism' ||
          itemClass === 'historic' ||
          itemClass === 'amenity' && ['place_of_worship', 'theatre', 'arts_centre'].includes(itemType) ||
          itemClass === 'leisure' && ['park', 'garden'].includes(itemType) ||
          itemType === 'museum' ||
          itemType === 'monument' ||
          itemType === 'attraction';

        if (!isTourist) continue;

        pois.push({
          title: name,
          description: item.display_name?.split(',').slice(1, 3).join(',').trim() || '',
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
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

      // Fetch from Nominatim OpenStreetMap API (rate-limited)
      await this.waitForNominatimSlot();
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
      this.logger.error(`Nominatim search failed for "${query}": ${error instanceof Error ? error.message : error}`);
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
          // Fetch from Nominatim reverse geocoding API (rate-limited)
          await this.waitForNominatimSlot();
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
          
          await this.waitForNominatimSlot();
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
