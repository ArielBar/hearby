import { IsString } from 'class-validator';

export class DownloadRegionDto {
  @IsString()
  city: string;

  @IsString()
  lang: string;
}
