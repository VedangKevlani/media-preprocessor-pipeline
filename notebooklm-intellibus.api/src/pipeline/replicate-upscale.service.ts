/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Replicate from 'replicate';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FrameExtractionService } from './frame-extraction.service';

export interface UpscaleResult {
  outputPath: string;
  upscaled: boolean;
  error?: string;
  framesFailed?: number;
  framesTotal?: number;
}

interface FrameUpscaleResult {
  inputPath: string;
  outputPath: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class ReplicateUpscaleService {
  private readonly logger = new Logger(ReplicateUpscaleService.name);
  private readonly replicate: Replicate;
  private readonly tempDir: string;
  private readonly maxRetries = 2;

  // Frame settings
  private readonly upscaleScale: number;
  private readonly frameParallelLimit: number;
  private readonly maxFrameWidth: number;
  private readonly secondsPerKeyframe: number;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => FrameExtractionService))
    private readonly frameService: FrameExtractionService,
  ) {
    const apiToken = this.configService.get<string>('REPLICATE_API_TOKEN');

    if (!apiToken) {
      this.logger.warn(
        'REPLICATE_API_TOKEN not set — upscaling will be skipped',
      );
    }

    this.replicate = new Replicate({ auth: apiToken });
    this.tempDir = path.join(process.cwd(), 'temp');

    // Configuration
    this.upscaleScale = parseInt(
      this.configService.get<string>('UPSCALE_SCALE', '2'),
      10,
    );
    this.frameParallelLimit = parseInt(
      this.configService.get<string>('FRAME_PARALLEL_LIMIT', '5'),
      10,
    );
    this.maxFrameWidth = parseInt(
      this.configService.get<string>('MAX_FRAME_WIDTH', '1920'),
      10,
    );
    this.secondsPerKeyframe = parseInt(
      this.configService.get<string>('SECONDS_PER_KEYFRAME', '3'),
      10,
    );

    this.logger.log(
      `Keyframe upscaling configured: scale=${this.upscaleScale}x, 1 keyframe every ${this.secondsPerKeyframe}s, maxWidth=${this.maxFrameWidth}px, parallel=${this.frameParallelLimit}`,
    );
  }

  /**
   * Upscales a video using keyframe-only processing.
   * Extracts 1 frame/second, upscales, then interpolates back to original FPS.
   * Ideal for slideshow-style NotebookLM videos.
   */
  async upscale(inputPath: string): Promise<UpscaleResult> {
    if (!fs.existsSync(inputPath)) {
      return {
        outputPath: inputPath,
        upscaled: false,
        error: `Input file not found: ${inputPath}`,
      };
    }

    const apiToken = this.configService.get<string>('REPLICATE_API_TOKEN');
    if (!apiToken) {
      this.logger.warn('Skipping upscale: REPLICATE_API_TOKEN not configured');
      return {
        outputPath: inputPath,
        upscaled: false,
        error: 'REPLICATE_API_TOKEN not configured',
      };
    }

    const inputFileName = path.basename(inputPath, path.extname(inputPath));
    const outputFileName = `${inputFileName}_upscaled.mp4`;
    const outputPath = path.join(this.tempDir, outputFileName);

    const workDir = path.join(this.tempDir, `upscale_${uuidv4()}`);
    const keyframesDir = path.join(workDir, 'keyframes');
    const downscaledDir = path.join(workDir, 'downscaled');
    const upscaledDir = path.join(workDir, 'upscaled');
    const audioPath = path.join(workDir, 'audio.aac');
    const interpolatedPath = path.join(workDir, 'interpolated.mp4');

    this.logger.log(`Starting keyframe upscale: ${inputPath}`);
    this.logger.log(`Working directory: ${workDir}`);

    try {
      fs.mkdirSync(keyframesDir, { recursive: true });
      fs.mkdirSync(downscaledDir, { recursive: true });
      fs.mkdirSync(upscaledDir, { recursive: true });

      // Step 1: Get metadata
      this.logger.log('Step 1/6: Getting video metadata...');
      const metadata = await this.frameService.getVideoMetadata(inputPath);
      const keyframeFps = 1 / this.secondsPerKeyframe;
      const expectedKeyframes = Math.ceil(metadata.duration * keyframeFps);
      this.logger.log(
        `Video: ${metadata.duration.toFixed(1)}s @ ${metadata.fps.toFixed(2)}fps → ~${expectedKeyframes} keyframes (1 every ${this.secondsPerKeyframe}s)`,
      );

      // Step 2: Extract audio
      this.logger.log('Step 2/6: Extracting audio...');
      const hasAudio = await this.frameService.extractAudio(
        inputPath,
        audioPath,
      );

      // Step 3: Extract keyframes
      this.logger.log('Step 3/6: Extracting keyframes...');
      const keyframeCount = await this.frameService.extractKeyframes(
        inputPath,
        keyframesDir,
        keyframeFps,
      );
      this.logger.log(`Extracted ${keyframeCount} keyframes`);

      const keyframeFiles = this.frameService.listFrameFiles(keyframesDir);

      // Step 4: Downscale + Upscale each keyframe
      this.logger.log(
        `Step 4/6: Upscaling ${keyframeFiles.length} keyframes (${this.frameParallelLimit} parallel)...`,
      );

      let failedFrames = 0;
      let completedFrames = 0;

      await this.parallelMap(
        keyframeFiles,
        async (framePath: string) => {
          const frameName = path.basename(framePath);
          const downscaledPath = path.join(downscaledDir, frameName);
          const upscaledPath = path.join(upscaledDir, frameName);

          // Auto-downscale if too large
          const { path: inputForUpscale } =
            await this.frameService.downscaleImage(
              framePath,
              downscaledPath,
              this.maxFrameWidth,
            );

          // Upscale
          const result = await this.upscaleImageWithRetry(
            inputForUpscale,
            upscaledPath,
          );

          completedFrames++;
          if (
            completedFrames % 5 === 0 ||
            completedFrames === keyframeFiles.length
          ) {
            this.logger.log(
              `Progress: ${completedFrames}/${keyframeFiles.length} keyframes`,
            );
          }

          if (!result.success) {
            failedFrames++;
            this.logger.warn(
              `Keyframe ${frameName} failed: ${result.error} — using original`,
            );
            fs.copyFileSync(framePath, upscaledPath);
          }

          return result;
        },
        this.frameParallelLimit,
      );

      this.logger.log(
        `Upscaled ${keyframeFiles.length} keyframes (${failedFrames} failures)`,
      );

      // Step 5: Interpolate keyframes to original FPS
      this.logger.log('Step 5/6: Interpolating to full video...');
      await this.frameService.interpolateFrames(
        upscaledDir,
        interpolatedPath,
        keyframeFps,
        metadata.fps,
      );

      // Step 6: Mux audio
      this.logger.log('Step 6/6: Muxing audio...');
      await this.frameService.muxAudio(
        interpolatedPath,
        hasAudio ? audioPath : null,
        outputPath,
      );

      // Cleanup
      this.frameService.cleanup(workDir);
      this.logger.log(`Keyframe upscale complete: ${outputPath}`);

      return {
        outputPath,
        upscaled: true,
        framesFailed: failedFrames,
        framesTotal: keyframeFiles.length,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Keyframe upscale failed: ${errorMessage}`);

      try {
        this.frameService.cleanup(workDir);
      } catch {
        // Ignore
      }

      return {
        outputPath: inputPath,
        upscaled: false,
        error: errorMessage,
      };
    }
  }

  private async upscaleImageWithRetry(
    inputPath: string,
    outputPath: string,
  ): Promise<FrameUpscaleResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Wait before retry (helps with rate limits)
        await this.sleep(1000 * attempt);
        this.logger.debug(
          `Retry ${attempt}/${this.maxRetries} for ${path.basename(inputPath)}`,
        );
      }

      try {
        await this.upscaleImage(inputPath, outputPath);
        return { inputPath, outputPath, success: true };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!this.isTransientError(lastError)) break;
      }
    }

    return {
      inputPath,
      outputPath,
      success: false,
      error: lastError?.message || 'Unknown error',
    };
  }

  private async upscaleImage(
    inputPath: string,
    outputPath: string,
  ): Promise<void> {
    const imageBuffer = fs.readFileSync(inputPath);
    const base64Image = imageBuffer.toString('base64');
    const dataUri = `data:image/png;base64,${base64Image}`;

    const output = await this.replicate.run('nightmareai/real-esrgan', {
      input: {
        image: dataUri,
        scale: this.upscaleScale,
        face_enhance: false,
      },
    });

    if (typeof output === 'string') {
      const response = await fetch(output);
      if (!response.ok) {
        throw new Error(
          `Failed to download upscaled image: ${response.status}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    } else {
      const { writeFile } = await import('fs/promises');
      await writeFile(outputPath, output as NodeJS.ArrayBufferView);
    }
  }

  private async parallelMap<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    concurrency: number,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let currentIndex = 0;

    const worker = async (): Promise<void> => {
      while (currentIndex < items.length) {
        const index = currentIndex++;
        results[index] = await fn(items[index], index);
      }
    };

    const workers = Array(Math.min(concurrency, items.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);
    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isTransientError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('500') ||
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('prediction failed')
    );
  }
}
