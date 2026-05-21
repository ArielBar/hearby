import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

export interface PointGeometry {
  type: 'Point';
  coordinates: [number, number];
}

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

  @Index({ spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  geometry!: PointGeometry;

  @Column({ type: 'varchar', nullable: true })
  wikipediaUrl!: string | null;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 2 })
  language!: string;

  @Column({ type: 'float', nullable: true })
  rating!: number | null;
}
