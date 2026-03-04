import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';

export interface VideoMetadata {
  fps: number;
  width: number;
  height: number;
  duration: number;
  frameCount: number;
}

@Injectable()
export class FrameExtractionService {
  private readonly logger = new Logger(FrameExtractionService.name);
  private readonly tempDir: string;

  constructor(private readonly configService: ConfigService) {
    this.tempDir = path.join(process.cwd(), 'temp');
  }

  /**
   * Gets comprehensive video metadata including FPS, resolution, duration, and frame count.
   */
  async getVideoMetadata(inputPath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }

        const videoStream = metadata.streams.find(
          (s) => s.codec_type === 'video',
        );

        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        const duration = metadata.format.duration || 0;
        const width = videoStream.width || 0;
        const height = videoStream.height || 0;

        // Parse FPS from r_frame_rate (e.g., "30000/1001" or "30/1")
        let fps = 30; // Default fallback
        if (videoStream.r_frame_rate) {
          const parts = videoStream.r_frame_rate.split('/');
          if (parts.length === 2) {
            fps = parseInt(parts[0], 10) / parseInt(parts[1], 10);
          } else {
            fps = parseFloat(videoStream.r_frame_rate);
          }
        }

        // Calculate frame count
        const frameCount = Math.ceil(duration * fps);

        resolve({
          fps,
          width,
          height,
          duration,
          frameCount,
        });
      });
    });
  }

  /**
   * Gets the duration of a video in seconds.
   */
  async getVideoDuration(inputPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        const duration = metadata.format.duration || 0;
        resolve(duration);
      });
    });
  }

  /**
   * Gets the resolution of a video.
   */
  async getVideoResolution(
    inputPath: string,
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        const videoStream = metadata.streams.find(
          (s) => s.codec_type === 'video',
        );
        if (!videoStream || !videoStream.width || !videoStream.height) {
          reject(new Error('Could not determine video resolution'));
          return;
        }
        resolve({
          width: videoStream.width,
          height: videoStream.height,
        });
      });
    });
  }

  /**
   * Extracts all frames from a video as PNG files.
   * Output pattern: frame_00001.png, frame_00002.png, etc.
   *
   * @param inputPath - Path to input video
   * @param outputDir - Directory to save frames (created if not exists)
   * @returns Number of frames extracted
   */
  async extractFrames(inputPath: string, outputDir: string): Promise<number> {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const framePattern = path.join(outputDir, 'frame_%05d.png');

    this.logger.log(`Extracting frames: ${inputPath} → ${outputDir}`);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-vsync vfr', // Variable frame rate to avoid duplicates
        ])
        .output(framePattern)
        .on('start', (cmd) => {
          this.logger.debug(`FFmpeg extract frames command: ${cmd}`);
        })
        .on('end', () => {
          // Count extracted frames
          const files = fs.readdirSync(outputDir);
          const frameCount = files.filter((f) =>
            /^frame_\d{5}\.png$/.test(f),
          ).length;
          this.logger.log(`Extracted ${frameCount} frames`);
          resolve(frameCount);
        })
        .on('error', (err) => {
          this.logger.error(`Frame extraction failed: ${err.message}`);
          reject(new Error(err.message));
        })
        .run();
    });
  }

  /**
   * Stitches PNG frames back into a video (without audio).
   *
   * @param frameDir - Directory containing frame_XXXXX.png files
   * @param outputPath - Output video path
   * @param fps - Frame rate for output video
   */
  async stitchFrames(
    frameDir: string,
    outputPath: string,
    fps: number,
  ): Promise<string> {
    const framePattern = path.join(frameDir, 'frame_%05d.png');

    this.logger.log(
      `Stitching frames: ${frameDir} → ${outputPath} @ ${fps}fps`,
    );

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(framePattern)
        .inputOptions([`-framerate ${fps}`])
        .outputOptions([
          '-c:v libx264',
          '-preset medium',
          '-crf 18',
          '-pix_fmt yuv420p', // Ensure compatibility
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          this.logger.debug(`FFmpeg stitch command: ${cmd}`);
        })
        .on('end', () => {
          this.logger.log(`Stitch complete: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error(`Stitch failed: ${err.message}`);
          reject(new Error(err.message));
        })
        .run();
    });
  }

  /**
   * Extracts audio track from a video to a separate file.
   *
   * @param inputPath - Path to input video
   * @param outputPath - Path where audio should be saved
   * @returns true if audio was extracted, false if no audio track found
   */
  async extractAudio(inputPath: string, outputPath: string): Promise<boolean> {
    this.logger.log(`Extracting audio: ${inputPath}`);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-vn', '-acodec copy'])
        .output(outputPath)
        .on('start', (cmd) => {
          this.logger.debug(`FFmpeg extract audio command: ${cmd}`);
        })
        .on('end', () => {
          this.logger.log(`Audio extracted: ${outputPath}`);
          resolve(true);
        })
        .on('error', (err) => {
          // Audio extraction might fail if video has no audio track
          if (
            err.message.includes('does not contain any stream') ||
            err.message.includes('no audio')
          ) {
            this.logger.warn('No audio track found in video');
            resolve(false);
          } else {
            this.logger.error(`Audio extraction failed: ${err.message}`);
            reject(err);
          }
        })
        .run();
    });
  }

  /**
   * Muxes audio back into a video file.
   *
   * @param videoPath - Path to video without audio
   * @param audioPath - Path to audio file (or null if no audio)
   * @param outputPath - Path for final output
   */
  async muxAudio(
    videoPath: string,
    audioPath: string | null,
    outputPath: string,
  ): Promise<string> {
    // If no audio, just copy the video
    if (!audioPath) {
      this.logger.log('No audio to mux, copying video as-is');
      fs.copyFileSync(videoPath, outputPath);
      return outputPath;
    }

    this.logger.log(`Muxing audio into video: ${videoPath}`);

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .outputOptions(['-c:v copy', '-c:a copy', '-map 0:v:0', '-map 1:a:0'])
        .output(outputPath)
        .on('start', (cmd) => {
          this.logger.debug(`FFmpeg mux command: ${cmd}`);
        })
        .on('end', () => {
          this.logger.log(`Mux complete: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error(`Mux failed: ${err.message}`);
          reject(new Error(err.message));
        })
        .run();
    });
  }

  /**
   * Cleans up a directory and all its contents.
   *
   * @param dirPath - Path to directory to remove
   */
  cleanup(dirPath: string): void {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        this.logger.debug(`Cleaned up directory: ${dirPath}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to clean up ${dirPath}: ${message}`);
    }
  }

  /**
   * Cleans up specific files.
   *
   * @param paths - Array of file paths to delete
   */
  cleanupFiles(paths: string[]): void {
    for (const filePath of paths) {
      try {
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          this.logger.debug(`Cleaned up: ${filePath}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to clean up ${filePath}: ${message}`);
      }
    }
  }

  /**
   * Lists all frame files in a directory, sorted by index.
   *
   * @param frameDir - Directory containing frame files
   * @returns Array of absolute paths to frame files, sorted
   */
  listFrameFiles(frameDir: string): string[] {
    const files = fs.readdirSync(frameDir);
    return files
      .filter((f) => /^frame_\d{5}\.png$/.test(f))
      .sort()
      .map((f) => path.join(frameDir, f));
  }

  /**
   * Extracts keyframes from a video at a specified rate (default: 1 per second).
   * Ideal for slideshow-style videos where most frames are static.
   *
   * @param inputPath - Path to input video
   * @param outputDir - Directory to save keyframes
   * @param framesPerSecond - How many frames to extract per second (default: 1)
   * @returns Number of keyframes extracted
   */
  async extractKeyframes(
    inputPath: string,
    outputDir: string,
    framesPerSecond: number = 1,
  ): Promise<number> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const framePattern = path.join(outputDir, 'frame_%05d.png');

    this.logger.log(
      `Extracting keyframes at ${framesPerSecond} fps: ${inputPath} → ${outputDir}`,
    );

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([`-vf fps=${framesPerSecond}`])
        .output(framePattern)
        .on('start', (cmd) => {
          this.logger.debug(`FFmpeg keyframe extraction command: ${cmd}`);
        })
        .on('end', () => {
          const files = fs.readdirSync(outputDir);
          const frameCount = files.filter((f) =>
            /^frame_\d{5}\.png$/.test(f),
          ).length;
          this.logger.log(`Extracted ${frameCount} keyframes`);
          resolve(frameCount);
        })
        .on('error', (err) => {
          this.logger.error(`Keyframe extraction failed: ${err.message}`);
          reject(new Error(err.message));
        })
        .run();
    });
  }

  /**
   * Interpolates keyframes back to full video using minterpolate filter.
   * Generates smooth in-between frames for slideshow-style content.
   *
   * @param frameDir - Directory containing upscaled keyframe PNGs
   * @param outputPath - Output video path
   * @param keyframeFps - FPS of input keyframes (e.g., 1)
   * @param targetFps - Target output FPS (e.g., 30)
   */
  async interpolateFrames(
    frameDir: string,
    outputPath: string,
    keyframeFps: number,
    targetFps: number,
  ): Promise<string> {
    const framePattern = path.join(frameDir, 'frame_%05d.png');

    this.logger.log(
      `Interpolating frames: ${keyframeFps}fps → ${targetFps}fps`,
    );

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(framePattern)
        .inputOptions([`-framerate ${keyframeFps}`])
        .outputOptions([
          `-vf minterpolate=fps=${targetFps}:mi_mode=blend`,
          '-c:v libx264',
          '-preset medium',
          '-crf 18',
          '-pix_fmt yuv420p',
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          this.logger.debug(`FFmpeg interpolation command: ${cmd}`);
        })
        .on('end', () => {
          this.logger.log(`Interpolation complete: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error(`Interpolation failed: ${err.message}`);
          reject(new Error(err.message));
        })
        .run();
    });
  }

  /**
   * Downscales an image if it exceeds maxWidth.
   * Preserves aspect ratio. Returns original path if no scaling needed.
   */
  async downscaleImage(
    inputPath: string,
    outputPath: string,
    maxWidth: number = 1920,
  ): Promise<{ path: string; wasDownscaled: boolean }> {
    const dimensions = await this.getImageDimensions(inputPath);

    if (dimensions.width <= maxWidth) {
      return { path: inputPath, wasDownscaled: false };
    }

    this.logger.debug(
      `Downscaling ${path.basename(inputPath)}: ${dimensions.width}px → ${maxWidth}px`,
    );

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([`-vf scale=${maxWidth}:-1`])
        .output(outputPath)
        .on('end', () => {
          resolve({ path: outputPath, wasDownscaled: true });
        })
        .on('error', (err) => {
          this.logger.error(`Downscale failed: ${err.message}`);
          reject(new Error(err.message));
        })
        .run();
    });
  }

  /**
   * Gets dimensions of an image file.
   */
  async getImageDimensions(
    imagePath: string,
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(imagePath, (err, metadata) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        const stream = metadata.streams.find((s) => s.codec_type === 'video');
        if (!stream || !stream.width || !stream.height) {
          reject(new Error('Could not determine image dimensions'));
          return;
        }
        resolve({ width: stream.width, height: stream.height });
      });
    });
  }
}
