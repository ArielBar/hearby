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

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

export type PoiWithDistance = PointOfInterest & { distanceInMeters: number };

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

  async findNearby(
    lat: number,
    lng: number,
    radiusInMeters: number,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<PoiWithDistance>> {
    const offset = (page - 1) * limit;
    const origin = `ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography`;

    // Base query builder with spatial filter (leverages GIST index)
    const baseQb = this.poisRepository
      .createQueryBuilder('poi')
      .where(`ST_DWithin(poi.coordinates, ${origin}, :radius)`)
      .setParameters({ lat, lng, radius: radiusInMeters });

    // Count total matching POIs (efficient – reuses the GIST index)
    const total = await baseQb.getCount();

    // Fetch paginated results with distance calculation
    const { raw, entities } = await this.poisRepository
      .createQueryBuilder('poi')
      .addSelect(`ST_Distance(poi.coordinates, ${origin})`, 'distance')
      .where(`ST_DWithin(poi.coordinates, ${origin}, :radius)`)
      .setParameters({ lat, lng, radius: radiusInMeters })
      .orderBy('distance', 'ASC')
      .offset(offset)
      .limit(limit)
      .getRawAndEntities();

    // Merge computed distance onto each entity
    const data: PoiWithDistance[] = entities.map((entity, index) => ({
      ...entity,
      distanceInMeters: parseFloat(raw[index]?.distance) || 0,
    }));

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }
}
