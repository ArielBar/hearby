import { Injectable, Logger } from '@nestjs/common';
import { WikipediaService } from '../wikipedia/wikipedia.service';
import { OpenAIService } from '../openai/openai.service';

/**
 * Enriched POI response with AI-generated audio script
 */
export interface EnrichResult {
  name: string;
  masterScript: string;
}

/**
 * POI Service - Hybrid approach for accuracy + quality
 * 
 * Process:
 * 1. Reverse geocode coordinates to get exact POI name (Nominatim)
 * 2. Send POI name to OpenAI for high-quality script generation
 * 
 * Best of both worlds: accurate location identification + AI-generated content
 */
@Injectable()
export class PoisService {
  private readonly logger = new Logger(PoisService.name);

  constructor(
    private readonly wikipediaService: WikipediaService,
    private readonly openaiService: OpenAIService,
  ) {}

  /**
   * Enrich a POI by coordinates using hybrid approach
   *
   * Strategy:
   * 1. Reverse geocode coordinates to get POI name (Nominatim - accurate)
   * 2. Send POI name to OpenAI for script generation (high-quality)
   * 3. Cache both steps for 7 days
   *
   * This hybrid approach combines Nominatim's geographical accuracy
   * with OpenAI's high-quality script generation.
   *
   * @param lat - Latitude of clicked location
   * @param lng - Longitude of clicked location
   * @returns AI-generated audio script or null if no tourist POI found
   */
  async enrichPoiByCoordinates(
    lat: number,
    lng: number,
  ): Promise<EnrichResult | null> {
    this.logger.log(`Enriching POI at coordinates: [${lat}, ${lng}]`);

    try {
      // Step 1: Reverse geocode to get POI name (Nominatim)
      const poi = await this.wikipediaService.reverseGeocode(lat, lng);

      if (!poi) {
        this.logger.debug(`No tourist POI found at [${lat}, ${lng}]`);
        return null;
      }

      this.logger.log(`✓ Identified POI: "${poi.name}" at [${lat}, ${lng}]`);

      // Step 2: Generate AI script for this POI (OpenAI)
      const audioScript = await this.openaiService.generateAudioScript(
        poi.name,
      );

      if (!audioScript) {
        this.logger.warn(
          `Failed to generate audio script for "${poi.name}" at [${lat}, ${lng}]`,
        );
        return null;
      }

      this.logger.log(
        `✓ Successfully generated audio script for "${poi.name}" at [${lat}, ${lng}]`,
      );

      return {
        name: audioScript.name,
        masterScript: audioScript.masterScript,
      };
    } catch (error) {
      this.logger.error(
        `Error enriching coordinates [${lat}, ${lng}]`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}
