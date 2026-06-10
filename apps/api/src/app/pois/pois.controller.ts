import { Controller, Get, Query, Res, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { PoisService, EnrichResult } from './pois.service';
import { ApiKeyGuard } from '../common';

@Controller('pois')
@UseGuards(ApiKeyGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PoisController {
  constructor(private readonly poisService: PoisService) {}

  @Get('enrich')
  @Throttle({ default: { ttl: 60000, limit: 15 } })
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
      res.status(204).send();
      return;
    }

    res.status(200).json(result);
  }

  /**
   * Stream TTS audio for a given text and language
   * Uses OpenAI TTS with Redis binary caching (7-day TTL)
   *
   * GET /api/pois/audio?text=...&lang=he
   * Response: audio/mpeg stream (chunked transfer)
   */
  @Get('audio')
  async getAudio(
    @Query('text') text: string,
    @Query('lang') lang: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!text || !text.trim()) {
      res.status(400).json({ message: 'text parameter is required' });
      return;
    }

    const language = lang || 'en';
    const audioBuffer = await this.poisService.getAudio(text.trim(), language);

    if (!audioBuffer) {
      res.status(500).json({ message: 'Failed to generate audio' });
      return;
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length.toString(),
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'public, max-age=604800',
    });
    res.end(audioBuffer);
  }
}
