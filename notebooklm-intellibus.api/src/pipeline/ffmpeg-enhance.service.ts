import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';

@Injectable()
export class FfmpegEnhanceService {
  private readonly logger = new Logger(FfmpegEnhanceService.name);
  private readonly saturation: number;
  private readonly contrast: number;
  private readonly tempDir: string;

  constructor(private readonly configService: ConfigService) {
    this.saturation = this.configService.get<number>('SATURATION', 1.5);
    this.contrast = this.configService.get<number>('CONTRAST', 1.2);
    // Use process.cwd() to resolve to project root, not dist/
    this.tempDir = path.join(process.cwd(), 'temp');
  }

  /**
   * Returns filter configuration for composability with other FFmpeg services.
   * Allows combining filters into a single FFmpeg pass when pipeline order permits.
   */
  getFilterConfig(): { filters: string[]; inputs: string[] } {
    return {
      filters: [`eq=saturation=${this.saturation}:contrast=${this.contrast}`],
      inputs: [],
    };
  }

  /**
   * Applies saturation and contrast enhancement to a video file.
   * @param inputPath - Absolute path to the input video file
   * @returns Promise resolving to the absolute path of the enhanced output file
   */
  async enhance(inputPath: string): Promise<string> {
    const inputFileName = path.basename(inputPath, path.extname(inputPath));
    const outputFileName = `${inputFileName}_enhanced.mp4`;
    const outputPath = path.join(this.tempDir, outputFileName);

    this.logger.log(`Starting enhancement: ${inputPath}`);
    this.logger.log(
      `Saturation: ${this.saturation}, Contrast: ${this.contrast}`,
    );

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters(
          `eq=saturation=${this.saturation}:contrast=${this.contrast}`,
        )
        .outputOptions([
          '-c:v libx264',
          '-preset medium',
          '-crf 18',
          '-c:a copy',
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          this.logger.debug(`FFmpeg command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            this.logger.debug(`Progress: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => {
          this.logger.log(`Enhancement complete: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error(`Enhancement failed: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }
}
