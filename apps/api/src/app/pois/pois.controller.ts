import { Controller, Get, Query, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { Response } from 'express';
import { PoisService, EnrichResult } from './pois.service';

/**
 * POI Controller - Simplified for on-demand enrichment only
 * 
 * Single endpoint: GET /api/pois/enrich?lat=X&lng=Y
 * Returns Wikipedia-enriched content for coordinates clicked by users on the map.
 */
@Controller('pois')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PoisController {
  constructor(private readonly poisService: PoisService) {}

  /**
   * Enrich a POI by coordinates using Wikipedia's geosearch API
   * 
   * @param lat - Latitude (e.g., 31.7767)
   * @param lng - Longitude (e.g., 35.2345)
   * @returns 200 with enriched data, or 204 if no tourist content found
   */
  @Get('enrich')
  async enrichPoiByCoordinates(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EnrichResult | void> {
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

    const result = await this.poisService.enrichPoiByCoordinates(latitude, longitude);
    
    if (!result) {
      // No tourist content found - return 204 No Content
      res.status(204).send();
      return;
    }

    return result;
  }
}
