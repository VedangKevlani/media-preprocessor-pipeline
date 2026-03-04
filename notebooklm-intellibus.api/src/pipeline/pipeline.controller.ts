import {
  Controller,
  Post,
  Get,
  Body,
  HttpException,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
  Res,
  Query,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import {
  VideoProcessingService,
  PipelineResult,
} from './video-processing.service';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { Response } from 'express';

interface ProcessRequestDto {
  inputPath: string;
}

interface StatusResponseDto {
  isProcessing: boolean;
}

@Controller('pipeline')
export class PipelineController {
  constructor(
    private readonly videoProcessingService: VideoProcessingService,
  ) {}

  /**
   * Process a video through the full pipeline:
   * enhance → upscale → logo removal + overlay
   */
  @Post()
  async process(@Body() body: ProcessRequestDto): Promise<PipelineResult> {
    const { inputPath } = body;

    if (!inputPath) {
      throw new HttpException('inputPath is required', HttpStatus.BAD_REQUEST);
    }

    // Verify input file exists before starting pipeline
    if (!fs.existsSync(inputPath)) {
      throw new HttpException(
        `Input file not found: ${inputPath}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.videoProcessingService.process(inputPath);
  }

  /**
   * Get current pipeline status (is it processing a video?)
   */
  @Get('status')
  getStatus(): StatusResponseDto {
    return this.videoProcessingService.getStatus();
  }

  /**
   * Download helper – serves files from the shared temp directory
   * by simple file name. The underlying pipeline services always
   * write outputs into this temp directory.
   */
  @Get('download')
  download(
    @Query('file') file: string,
    @Res() res: Response,
  ): void {
    if (!file) {
      throw new HttpException('file query param is required', HttpStatus.BAD_REQUEST);
    }

    const tempDir = path.join(process.cwd(), 'temp');
    const filePath = path.join(tempDir, file);

    if (!fs.existsSync(filePath)) {
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    }

    res.download(filePath);
  }

  /**
   * UI-friendly endpoint that accepts uploaded media + logo via multipart/form-data.
   * Routes requests to the correct pipeline based on mediaType.
   */
  @Post('process-media')
  @UseInterceptors(AnyFilesInterceptor())
  async processMedia(
    @UploadedFiles() files: any[],
    @Body() body: any,
  ): Promise<{ success: boolean; downloadUrl: string }> {
    const mediaType = body.mediaType as
      | 'slide_deck'
      | 'video'
      | 'infographics'
      | undefined;

    const logoFile = files.find((f) => f.fieldname === 'logo');
    const mediaFiles = files.filter((f) => f.fieldname === 'mediaFiles');

    if (!logoFile || mediaFiles.length === 0) {
      throw new HttpException(
        'logo and at least one media file are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!mediaType) {
      throw new HttpException(
        'mediaType is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Persist uploaded logo to temp so Python/FFmpeg can use it
    const logoPath = path.join(
      tempDir,
      `logo_${Date.now()}_${logoFile.originalname}`,
    );
    fs.writeFileSync(logoPath, logoFile.buffer);

    if (mediaType === 'video') {
      return this.handleVideoPipeline(mediaFiles[0], logoPath);
    }

    if (mediaType === 'slide_deck') {
      const pptxFile = mediaFiles.find(
        (f) =>
          f.originalname.toLowerCase().endsWith('.pptx') ||
          (f.mimetype && f.mimetype.includes('presentation')),
      );

      if (pptxFile) {
        return this.handleSlideDeckPptx(pptxFile, logoPath);
      }

      // Fallback: treat PNG slides like infographics for now
      return this.handleInfographicPng(mediaFiles, logoPath);
    }

    if (mediaType === 'infographics') {
      return this.handleInfographicPng(mediaFiles, logoPath);
    }

    throw new HttpException(
      `Unsupported mediaType: ${mediaType}`,
      HttpStatus.BAD_REQUEST,
    );
  }

  private async handleVideoPipeline(
    mediaFile: any,
    _logoPath: string,
  ): Promise<{ success: boolean; downloadUrl: string }> {
    const tempDir = path.join(process.cwd(), 'temp');
    const inputPath = path.join(
      tempDir,
      `video_${Date.now()}_${mediaFile.originalname}`,
    );
    fs.writeFileSync(inputPath, mediaFile.buffer);

    const result: PipelineResult =
      await this.videoProcessingService.process(inputPath);

    if (!result.success || !result.outputPath) {
      throw new HttpException(
        result.error || 'Video pipeline failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const fileName = path.basename(result.outputPath);
    return {
      success: true,
      downloadUrl: `/pipeline/download?file=${encodeURIComponent(fileName)}`,
    };
  }

  private async handleSlideDeckPptx(
    mediaFile: any,
    logoPath: string,
  ): Promise<{ success: boolean; downloadUrl: string }> {
    const tempDir = path.join(process.cwd(), 'temp');
    const rootDir = path.join(process.cwd(), '..');
    const scriptPath = path.join(rootDir, 'slides.py');

    const inputPath = path.join(
      tempDir,
      `slides_${Date.now()}_${mediaFile.originalname}`,
    );
    fs.writeFileSync(inputPath, mediaFile.buffer);

    const baseName = path.basename(mediaFile.originalname, '.pptx');
    const outputFileName = `${baseName}_processed.pptx`;
    const outputPath = path.join(tempDir, outputFileName);

    await this.runPythonScript(scriptPath, [inputPath, logoPath, outputPath]);

    if (!fs.existsSync(outputPath)) {
      throw new HttpException(
        'Slide deck processing failed: output not found',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      success: true,
      downloadUrl: `/pipeline/download?file=${encodeURIComponent(
        outputFileName,
      )}`,
    };
  }

  private async handleInfographicPng(
    mediaFiles: any[],
    logoPath: string,
  ): Promise<{ success: boolean; downloadUrl: string }> {
    if (mediaFiles.length !== 1) {
      throw new HttpException(
        'For now, only a single PNG is supported for infographics/slide images.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const tempDir = path.join(process.cwd(), 'temp');
    const rootDir = path.join(process.cwd(), '..');
    const scriptPath = path.join(rootDir, 'image_pipeline.py');

    const mediaFile = mediaFiles[0];
    const inputPath = path.join(
      tempDir,
      `image_${Date.now()}_${mediaFile.originalname}`,
    );
    fs.writeFileSync(inputPath, mediaFile.buffer);

    const baseName = path.basename(
      mediaFile.originalname,
      path.extname(mediaFile.originalname),
    );

    const outputPngName = `${baseName}_processed.png`;
    const outputPngPath = path.join(tempDir, outputPngName);

    await this.runPythonScript(scriptPath, [inputPath, logoPath, outputPngPath]);

    if (!fs.existsSync(outputPngPath)) {
      throw new HttpException(
        'Image processing failed: output not found',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Convert processed PNG → AVIF using FFmpeg (same settings as png-to-avif)
    const outputAvifName = `${baseName}_processed.avif`;
    const outputAvifPath = path.join(tempDir, outputAvifName);

    await this.runFfmpegPngToAvif(outputPngPath, outputAvifPath);

    const downloadName = fs.existsSync(outputAvifPath)
      ? outputAvifName
      : outputPngName;

    return {
      success: true,
      downloadUrl: `/pipeline/download?file=${encodeURIComponent(
        downloadName,
      )}`,
    };
  }

  private runPythonScript(scriptPath: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(scriptPath)) {
        reject(new Error(`Python script not found at ${scriptPath}`));
        return;
      }

      const candidates: string[] = [];
      if (process.env.PYTHON_CMD) {
        candidates.push(process.env.PYTHON_CMD);
      }
      candidates.push('python', 'py', 'python3');

      const trySpawn = (index: number, lastError?: Error) => {
        if (index >= candidates.length) {
          reject(
            lastError ||
              new Error(
                'No suitable Python executable found. Set PYTHON_CMD env var to your python path.',
              ),
          );
          return;
        }

        const cmd = candidates[index];
        const child = spawn(cmd, [scriptPath, ...args], {
          cwd: path.dirname(scriptPath),
        });

        let stderr = '';
        let errorHandled = false;

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
          if (errorHandled) return;
          errorHandled = true;

          if (err.code === 'ENOENT') {
            trySpawn(index + 1, err);
          } else {
            reject(err);
          }
        });

        child.on('close', (code) => {
          if (errorHandled) return;

          if (code === 0) {
            resolve();
            return;
          }

          // On Windows, "python" app execution alias can exist but print
          // "Python was not found" and exit with code 9009. In that case,
          // try the next candidate (e.g., "py") instead of failing outright.
          const stderrLower = stderr.toLowerCase();
          const looksLikeMissingPython =
            code === 9009 ||
            stderrLower.includes('python was not found') ||
            stderrLower.includes('is not recognized');

          if (looksLikeMissingPython) {
            trySpawn(
              index + 1,
              new Error(
                `Python candidate "${cmd}" failed with code ${code}: ${stderr}`,
              ),
            );
            return;
          }

          reject(
            new Error(
              `Python script exited with code ${code}: ${stderr}`,
            ),
          );
        });
      };

      trySpawn(0);
    });
  }

  private runFfmpegPngToAvif(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-c:v',
        'libaom-av1',
        '-lossless',
        '1',
        '-cpu-used',
        '4',
        '-pix_fmt',
        'yuv444p',
        '-still-picture',
        '1',
        outputPath,
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          // If AVIF fails for any reason, fall back to PNG without failing the whole request
          // but log the error for debugging.
          // eslint-disable-next-line no-console
          console.error(
            `ffmpeg AVIF conversion failed with code ${code}: ${stderr}`,
          );
          resolve();
        }
      });
    });
  }
}
