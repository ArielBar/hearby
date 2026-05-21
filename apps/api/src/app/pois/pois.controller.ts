import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseFloatPipe,
  ParseIntPipe,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PoisService } from './pois.service';
import { SearchPoisDto, DownloadRegionDto } from './dto';
import { PointOfInterestDto } from '@hearby/shared-types';
import { OfflinePoiDto, PaginatedResult, PoiWithDistance } from './pois.service';

@Controller('pois')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PoisController {
  constructor(private readonly poisService: PoisService) {}

  @Get('nearby')
  async findNearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
    @Query('radius', new DefaultValuePipe(5000), ParseIntPipe) radius: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<PaginatedResult<PoiWithDistance>> {
    return this.poisService.findNearby(lat, lng, radius, page, limit);
  }

  @Get('search')
  async search(@Query() dto: SearchPoisDto): Promise<PointOfInterestDto[]> {
    return this.poisService.searchNearby(dto);
  }

  @Get('download-region')
  async downloadRegion(@Query() dto: DownloadRegionDto): Promise<OfflinePoiDto[]> {
    return this.poisService.downloadRegion(dto);
  }
}
