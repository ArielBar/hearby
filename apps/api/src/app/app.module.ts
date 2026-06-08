import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PoisModule } from './pois/pois.module';
import { SearchModule } from './search/search.module';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), 'apps', 'api', `.env.${process.env['NODE_ENV'] || 'development'}`),
        join(process.cwd(), 'apps', 'api', '.env'),
        join(process.cwd(), '.env'),
      ],
    }),
    PoisModule,
    SearchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
