import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PointOfInterest } from '../entities/point-of-interest.entity';
import { PoisController } from './pois.controller';
import { PoisService } from './pois.service';

@Module({
  imports: [TypeOrmModule.forFeature([PointOfInterest])],
  controllers: [PoisController],
  providers: [PoisService],
  exports: [PoisService],
})
export class PoisModule {}
