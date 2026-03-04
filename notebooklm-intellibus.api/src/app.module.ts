import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PipelineModule } from './pipeline/pipeline.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PipelineModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
