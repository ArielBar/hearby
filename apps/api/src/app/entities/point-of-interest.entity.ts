import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';
import { Point } from 'geojson';
import { ValueTransformer } from 'typeorm';

/**
 * Ensures coordinates are stored in GeoJSON standard order: [longitude, latitude].
 * PostGIS returns geometry as GeoJSON by default when using the `geography` column type,
 * but this transformer guarantees consistent serialisation on both read and write.
 */
export const PointTransformer: ValueTransformer = {
  to(value: Point | null): Point | null {
    if (!value) return null;
    // Enforce GeoJSON order: [longitude, latitude]
    return {
      type: 'Point',
      coordinates: [value.coordinates[0], value.coordinates[1]],
    };
  },
  from(value: Point | null): Point | null {
    // PostGIS returns GeoJSON-compliant objects; pass through as-is
    return value;
  },
};

@Entity('pois')
export class PointOfInterest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Index()
  @Column({
    type: 'varchar',
    transformer: {
      to: (v: string) => v?.toLowerCase(),
      from: (v: string) => v,
    },
  })
  city!: string;

  /**
   * Spatial column using PostGIS `geography` type for accurate distance calculations
   * on the Earth's surface. SRID 4326 = WGS84 (GPS standard).
   * Coordinates follow GeoJSON order: [longitude, latitude].
   */
  @Index({ spatial: true })
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    transformer: PointTransformer,
  })
  coordinates!: Point;

  @Column({ type: 'varchar', nullable: true })
  wikipediaUrl!: string | null;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 2 })
  language!: string;

  @Column({ type: 'float', nullable: true })
  rating!: number | null;
}
