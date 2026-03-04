import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';

export interface FilterConfig {
  filters: string[];
  inputs: string[];
}

@Injectable()
export class FfmpegLogoService {
  private readonly logger = new Logger(FfmpegLogoService.name);
  private readonly tempDir: string;
  private readonly assetsDir: string;

  // NotebookLM logo coordinates (for removal)
  private readonly delogoX: number;
  private readonly delogoY: number;
  private readonly delogoW: number;
  private readonly delogoH: number;

  // Intellibus logo position (for overlay)
  private readonly overlayX: number;
  private readonly overlayY: number;
  private readonly logoScale: number;
  private readonly logoPath: string;

  constructor(private readonly configService: ConfigService) {
    // Use process.cwd() to resolve to project root, not dist/
    this.tempDir = path.join(process.cwd(), 'temp');
    this.assetsDir = path.join(__dirname, '..', '..', '..', 'assets');

    // Load delogo coordinates from config
    this.delogoX = this.configService.get<number>('NOTEBOOKLM_LOGO_X', 1096);
    this.delogoY = this.configService.get<number>('NOTEBOOKLM_LOGO_Y', 662);
    this.delogoW = this.configService.get<number>('NOTEBOOKLM_LOGO_W', 143);
    this.delogoH = this.configService.get<number>('NOTEBOOKLM_LOGO_H', 18);

    // Load overlay position from config
    this.overlayX = this.configService.get<number>('INTELLIBUS_LOGO_X', 1096);
    this.overlayY = this.configService.get<number>('INTELLIBUS_LOGO_Y', 662);
    this.logoScale = this.configService.get<number>(
      'INTELLIBUS_LOGO_SCALE',
      1.0,
    );

    this.logoPath = path.join(this.assetsDir, 'intellibus_logo.png');
  }

  /**
   * Returns filter configuration for composability with other FFmpeg services.
   * Allows combining filters into a single FFmpeg pass when pipeline order permits.
   */
  getFilterConfig(): FilterConfig {
    return {
      filters: [
        `delogo=x=${this.delogoX}:y=${this.delogoY}:w=${this.delogoW}:h=${this.delogoH}`,
        `scale=iw*${this.logoScale}:ih*${this.logoScale}`,
        `overlay=${this.overlayX}:${this.overlayY}`,
      ],
      inputs: [this.logoPath],
    };
  }

  /**
   * Applies logo removal (delogo) and Intellibus logo overlay to a video file.
   * @param inputPath - Absolute path to the input video file
   * @returns Promise resolving to the absolute path of the branded output file
   */
  async applyLogo(inputPath: string): Promise<string> {
    // Validate logo file exists
    if (!fs.existsSync(this.logoPath)) {
      throw new Error(
        `Intellibus logo not found at ${this.logoPath}. Please add intellibus_logo.png to the assets folder.`,
      );
    }

    const inputFileName = path.basename(inputPath, path.extname(inputPath));
    const outputFileName = `${inputFileName}_branded.mp4`;
    const outputPath = path.join(this.tempDir, outputFileName);

    this.logger.log(`Starting logo processing: ${inputPath}`);
    this.logger.log(
      `Delogo: x=${this.delogoX}, y=${this.delogoY}, w=${this.delogoW}, h=${this.delogoH}`,
    );
    this.logger.log(
      `Overlay position: x=${this.overlayX}, y=${this.overlayY}, scale=${this.logoScale}`,
    );

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .input(this.logoPath)
        .complexFilter([
          // Scale the Intellibus logo
          `[1:v]scale=iw*${this.logoScale}:ih*${this.logoScale}[logo]`,
          // Apply delogo to blur/remove the NotebookLM watermark
          `[0:v]delogo=x=${this.delogoX}:y=${this.delogoY}:w=${this.delogoW}:h=${this.delogoH}[delogoed]`,
          // Overlay the scaled Intellibus logo
          `[delogoed][logo]overlay=${this.overlayX}:${this.overlayY}[out]`,
        ])
        .outputOptions([
          '-map [out]',
          '-map 0:a?',
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
          this.logger.log(`Logo processing complete: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error(`Logo processing failed: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }
}
