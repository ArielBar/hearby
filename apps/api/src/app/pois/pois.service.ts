import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PointOfInterest } from '../entities/point-of-interest.entity';
import { PointOfInterestDto } from '@hearby/shared-types';
import { SearchPoisDto } from './dto/search-pois.dto';
import { DownloadRegionDto } from './dto/download-region.dto';

export interface OfflinePoiDto {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
}

@Injectable()
export class PoisService {
  constructor(
    @InjectRepository(PointOfInterest)
    private readonly poisRepository: Repository<PointOfInterest>,
  ) {}

  async searchNearby(dto: SearchPoisDto): Promise<PointOfInterestDto[]> {
    const { lat, lng, radius, lang } = dto;

    const pois = await this.poisRepository
      .createQueryBuilder('poi')
      .select([
        'poi.id',
        'poi.name',
        'poi.city',
        'poi.coordinates',
        'poi.description',
        'poi.language',
      ])
      .addSelect(
        `ST_Distance(poi.coordinates, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)`,
        'distance',
      )
      .where(
        `ST_DWithin(poi.coordinates, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius)`,
      )
      .andWhere('poi.language = :lang')
      .setParameters({ lat, lng, radius, lang })
      .orderBy('distance', 'ASC')
      .getRawAndEntities();

    return pois.entities.map((poi) => ({
      id: poi.id,
      name: poi.name,
      city: poi.city,
      latitude: poi.coordinates.coordinates[1],
      longitude: poi.coordinates.coordinates[0],
      description: poi.description,
      language: poi.language,
    }));
  }

  async downloadRegion(dto: DownloadRegionDto): Promise<OfflinePoiDto[]> {
    const { city, lang } = dto;

    const pois = await this.poisRepository
      .createQueryBuilder('poi')
      .select([
        'poi.id AS id',
        'poi.name AS name',
        'ST_Y(poi.coordinates::geometry) AS latitude',
        'ST_X(poi.coordinates::geometry) AS longitude',
        'poi.description AS description',
      ])
      .where('poi.city = :city', { city: city.toLowerCase() })
      .andWhere('poi.language = :lang', { lang })
      .getRawMany<OfflinePoiDto>();

    return pois;
  }
}
