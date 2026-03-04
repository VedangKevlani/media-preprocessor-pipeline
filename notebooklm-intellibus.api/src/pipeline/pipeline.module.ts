import { Module } from '@nestjs/common';
import { FfmpegEnhanceService } from './ffmpeg-enhance.service';
import { FfmpegLogoService } from './ffmpeg-logo.service';
import { ReplicateUpscaleService } from './replicate-upscale.service';
import { VideoProcessingService } from './video-processing.service';
import { FrameExtractionService } from './frame-extraction.service';
import { EnhanceController } from './enhance.controller';
import { LogoController } from './logo.controller';
import { UpscaleController } from './upscale.controller';
import { PipelineController } from './pipeline.controller';

@Module({
  controllers: [
    EnhanceController,
    LogoController,
    UpscaleController,
    PipelineController,
  ],
  providers: [
    FfmpegEnhanceService,
    FfmpegLogoService,
    ReplicateUpscaleService,
    VideoProcessingService,
    FrameExtractionService,
  ],
  exports: [
    FfmpegEnhanceService,
    FfmpegLogoService,
    ReplicateUpscaleService,
    VideoProcessingService,
    FrameExtractionService,
  ],
})
export class PipelineModule {}
