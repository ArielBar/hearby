import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PoisService } from './pois.service';
import { SearchPoisDto, DownloadRegionDto } from './dto';
import { PointOfInterestDto } from '@hearby/shared-types';
import { OfflinePoiDto } from './pois.service';

@Controller('pois')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PoisController {
  constructor(private readonly poisService: PoisService) {}

  @Get('search')
  async search(@Query() dto: SearchPoisDto): Promise<PointOfInterestDto[]> {
    return this.poisService.searchNearby(dto);
  }

  @Get('download-region')
  async downloadRegion(@Query() dto: DownloadRegionDto): Promise<OfflinePoiDto[]> {
    return this.poisService.downloadRegion(dto);
  }
}
