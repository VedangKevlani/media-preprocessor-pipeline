/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FfmpegEnhanceService } from './ffmpeg-enhance.service';
import { FfmpegLogoService } from './ffmpeg-logo.service';
import {
  ReplicateUpscaleService,
  UpscaleResult,
} from './replicate-upscale.service';
import * as fs from 'fs';
import * as path from 'path';

export interface StepResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  error?: string;
  skipped?: boolean;
}

export interface PipelineResult {
  success: boolean;
  outputPath: string;
  originalName: string;
  steps: {
    enhance: StepResult;
    upscale: StepResult;
    logo: StepResult;
  };
  totalDurationMs: number;
  error?: string;
}

@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);
  private readonly tempDir: string;
  private readonly cleanupIntermediateFiles: boolean;

  // v1 concurrency guard — prevents overlapping pipeline runs
  private isProcessing = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly enhanceService: FfmpegEnhanceService,
    private readonly upscaleService: ReplicateUpscaleService,
    private readonly logoService: FfmpegLogoService,
  ) {
    this.tempDir = path.join(process.cwd(), 'temp');
    this.cleanupIntermediateFiles =
      this.configService.get<string>('CLEANUP_INTERMEDIATE_FILES', 'true') ===
      'true';
  }

  /**
   * Returns current processing status.
   */
  getStatus(): { isProcessing: boolean } {
    return { isProcessing: this.isProcessing };
  }

  /**
   * Processes a video through the full pipeline:
   * enhance → upscale → logo removal + overlay
   *
   * @param inputPath - Absolute path to the input video file
   * @returns Promise resolving to PipelineResult with step details and final output
   * @throws ServiceUnavailableException if pipeline is already processing another video
   */
  async process(inputPath: string): Promise<PipelineResult> {
    // v1 concurrency guard
    if (this.isProcessing) {
      throw new ServiceUnavailableException(
        'Pipeline is currently processing another video. Please try again later.',
      );
    }

    // Validate input file exists
    if (!fs.existsSync(inputPath)) {
      return {
        success: false,
        outputPath: '',
        originalName: path.basename(inputPath),
        steps: {
          enhance: {
            success: false,
            outputPath: '',
            durationMs: 0,
            error: 'Input file not found',
          },
          upscale: {
            success: false,
            outputPath: '',
            durationMs: 0,
            skipped: true,
          },
          logo: {
            success: false,
            outputPath: '',
            durationMs: 0,
            skipped: true,
          },
        },
        totalDurationMs: 0,
        error: `Input file not found: ${inputPath}`,
      };
    }

    const pipelineStartTime = Date.now();
    const originalName = path.basename(inputPath, path.extname(inputPath));
    const intermediatePaths: string[] = [];

    // Initialize result structure
    const result: PipelineResult = {
      success: false,
      outputPath: '',
      originalName,
      steps: {
        enhance: { success: false, outputPath: '', durationMs: 0 },
        upscale: { success: false, outputPath: '', durationMs: 0 },
        logo: { success: false, outputPath: '', durationMs: 0 },
      },
      totalDurationMs: 0,
    };

    this.isProcessing = true;
    this.logger.log(`Starting pipeline for: ${inputPath}`);

    try {
      // ─────────────────────────────────────────────────────────────
      // Step 1: Enhance (saturation + contrast)
      // ─────────────────────────────────────────────────────────────
      this.logger.log('Step 1/3: Enhancing video...');
      const enhanceStartTime = Date.now();

      let enhancedPath: string;
      try {
        enhancedPath = await this.enhanceService.enhance(inputPath);
        result.steps.enhance = {
          success: true,
          outputPath: enhancedPath,
          durationMs: Date.now() - enhanceStartTime,
        };
        intermediatePaths.push(enhancedPath);
        this.logger.log(`Step 1/3 complete: ${enhancedPath}`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        result.steps.enhance = {
          success: false,
          outputPath: '',
          durationMs: Date.now() - enhanceStartTime,
          error: errorMessage,
        };
        result.error = `Enhancement failed: ${errorMessage}`;
        result.totalDurationMs = Date.now() - pipelineStartTime;
        this.logger.error(`Step 1/3 failed: ${errorMessage}`);
        return result;
      }

      // ─────────────────────────────────────────────────────────────
      // Step 2: Logo removal + Intellibus overlay
      // (Must happen BEFORE upscaling to preserve correct coordinates)
      // ─────────────────────────────────────────────────────────────
      this.logger.log('Step 2/3: Applying logo processing...');
      const logoStartTime = Date.now();

      let brandedPath: string;
      try {
        brandedPath = await this.logoService.applyLogo(enhancedPath);
        result.steps.logo = {
          success: true,
          outputPath: brandedPath,
          durationMs: Date.now() - logoStartTime,
        };
        intermediatePaths.push(brandedPath);
        this.logger.log(`Step 2/3 complete: ${brandedPath}`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        result.steps.logo = {
          success: false,
          outputPath: '',
          durationMs: Date.now() - logoStartTime,
          error: errorMessage,
        };
        result.error = `Logo processing failed: ${errorMessage}`;
        result.totalDurationMs = Date.now() - pipelineStartTime;
        this.logger.error(`Step 2/3 failed: ${errorMessage}`);
        return result;
      }

      // ─────────────────────────────────────────────────────────────
      // Step 3: Upscale (Replicate API — graceful fallback on failure)
      // ─────────────────────────────────────────────────────────────
      this.logger.log('Step 3/3: Upscaling video...');
      const upscaleStartTime = Date.now();

      let upscaleResult: UpscaleResult;
      try {
        upscaleResult = await this.upscaleService.upscale(brandedPath);
        result.steps.upscale = {
          success: upscaleResult.upscaled,
          outputPath: upscaleResult.outputPath,
          durationMs: Date.now() - upscaleStartTime,
          error: upscaleResult.error,
          skipped: !upscaleResult.upscaled,
        };

        if (upscaleResult.upscaled) {
          intermediatePaths.push(upscaleResult.outputPath);
          this.logger.log(`Step 3/3 complete: ${upscaleResult.outputPath}`);
        } else {
          this.logger.warn(
            `Step 3/3 skipped/failed: ${upscaleResult.error || 'Unknown reason'}. Continuing with branded video.`,
          );
        }
      } catch (error) {
        // Unexpected error — log and continue with branded path
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        result.steps.upscale = {
          success: false,
          outputPath: brandedPath,
          durationMs: Date.now() - upscaleStartTime,
          error: errorMessage,
          skipped: true,
        };
        upscaleResult = {
          outputPath: brandedPath,
          upscaled: false,
          error: errorMessage,
        };
        this.logger.warn(
          `Step 3/3 failed unexpectedly: ${errorMessage}. Continuing with branded video.`,
        );
      }

      // ─────────────────────────────────────────────────────────────
      // Rename final output to {originalName}_processed.mp4
      // ─────────────────────────────────────────────────────────────
      const finalOutputPath = path.join(
        this.tempDir,
        `${originalName}_processed.mp4`,
      );

      try {
        // If a file with that name already exists, remove it
        if (fs.existsSync(finalOutputPath)) {
          fs.unlinkSync(finalOutputPath);
        }
        fs.renameSync(upscaleResult.outputPath, finalOutputPath);
        this.logger.log(`Final output: ${finalOutputPath}`);
      } catch (error) {
        // Rename failed — use upscaled/branded path as final
        this.logger.warn(
          `Could not rename to _processed.mp4, using output path: ${upscaleResult.outputPath}`,
        );
        result.outputPath = upscaleResult.outputPath;
      }

      result.success = true;
      result.outputPath = finalOutputPath;
      result.totalDurationMs = Date.now() - pipelineStartTime;

      this.logger.log(
        `Pipeline complete in ${(result.totalDurationMs / 1000).toFixed(1)}s: ${result.outputPath}`,
      );

      // ─────────────────────────────────────────────────────────────
      // Cleanup intermediate files
      // ─────────────────────────────────────────────────────────────
      if (this.cleanupIntermediateFiles) {
        this.cleanup(intermediatePaths);
      }

      return result;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Deletes intermediate files to free up disk space.
   */
  private cleanup(paths: string[]): void {
    for (const filePath of paths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          this.logger.debug(`Cleaned up intermediate file: ${filePath}`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to cleanup ${filePath}: ${errorMessage}`);
      }
    }
  }
}
