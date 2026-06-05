import { Controller, Get, Query, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { Response } from 'express';
import { PoisService, EnrichResult } from './pois.service';

/**
 * POI Controller - AI-powered audio guide enrichment
 * 
 * Single endpoint: GET /api/pois/enrich?lat=X&lng=Y
 * Returns OpenAI-generated audio guide scripts for tourist landmarks.
 * 
 * Response format: { name: string, masterScript: string }
 */
@Controller('pois')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PoisController {
  constructor(private readonly poisService: PoisService) {}

  /**
   * Enrich a POI by coordinates using AI-generated audio script
   * 
   * Process:
   * 1. Reverse geocoding: Find nearest tourist landmark within 50-100m
   * 2. If found, generate captivating audio guide script using OpenAI
   * 3. Cache the script for 7 days
   * 
   * @param lat - Latitude (e.g., 31.7767)
   * @param lng - Longitude (e.g., 35.2345)
   * @returns 200 with { name, masterScript }, or 204 if no tourist landmark found
   */
  @Get('enrich')
  async enrichPoiByCoordinates(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('lang') lang: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!lat || !lng) {
      res.status(400).json({ message: 'lat and lng parameters are required' });
      return;
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      res.status(400).json({ message: 'lat and lng must be valid numbers' });
      return;
    }

    const language = lang || 'en';
    const result = await this.poisService.enrichPoiByCoordinates(latitude, longitude, language);
    
    if (!result) {
      // No tourist content found - return 204 No Content
      res.status(204).send();
      return;
    }

    // Return 200 with the enriched POI data
    res.status(200).json(result);
  }
}
