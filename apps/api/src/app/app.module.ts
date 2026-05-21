import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PoisModule } from './pois/pois.module';

@Module({
  imports: [PoisModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
