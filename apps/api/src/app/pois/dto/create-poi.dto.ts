import { IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';
import { Point } from 'geojson';

export class CreatePointOfInterestDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  /**
   * Transforms the flat latitude/longitude fields into a GeoJSON Point structure.
   * Coordinates follow GeoJSON standard: [longitude, latitude].
   */
  toGeoPoint(): Point {
    return {
      type: 'Point',
      coordinates: [this.longitude, this.latitude],
    };
  }
}
