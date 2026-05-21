import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchPoisDto {
  @Type(() => Number)
  @IsNumber()
  lat: number;

  @Type(() => Number)
  @IsNumber()
  lng: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(1)
  radius: number = 500;

  @IsString()
  @IsOptional()
  lang: string = 'he';
}
