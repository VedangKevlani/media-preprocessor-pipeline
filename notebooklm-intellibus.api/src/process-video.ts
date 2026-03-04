#!/usr/bin/env node
/**
 * CLI script for processing videos through the NotebookLM video processor pipeline.
 *
 * Usage:
 *   npx tsx src/process-video.ts <input-video-path>
 *
 * Example:
 *   npx tsx src/process-video.ts "C:\Videos\notebooklm-export.mp4"
 *
 * Output:
 *   Processed video saved to same directory as input with "_processed" suffix.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { VideoProcessingService } from './pipeline/video-processing.service';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
NotebookLM Video Processor CLI

Usage:
  npx tsx src/process-video.ts <input-video-path>

Arguments:
  input-video-path    Path to the video file to process (MP4)

Options:
  -h, --help          Show this help message

Example:
  npx tsx src/process-video.ts "C:\\Videos\\my-video.mp4"
  npx tsx src/process-video.ts ./input/video.mp4

Output:
  Processed video is saved to the same directory as the input file
  with "_processed" suffix (e.g., my-video_processed.mp4)

Environment:
  Configure .env file before running. Key settings:
  - REPLICATE_API_TOKEN     Required for AI upscaling
  - SECONDS_PER_KEYFRAME    Keyframe interval (default: 3)
  - FRAME_PARALLEL_LIMIT    Concurrent API calls (default: 5)
    `);
    process.exit(0);
  }

  const inputPath = path.resolve(args[0]);

  // Validate input file exists
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Validate file extension
  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== '.mp4') {
    console.error(`Error: Only MP4 files are supported. Got: ${ext}`);
    process.exit(1);
  }

  console.log('═'.repeat(60));
  console.log('NotebookLM Video Processor');
  console.log('═'.repeat(60));
  console.log(`Input:  ${inputPath}`);
  console.log('');

  try {
    // Bootstrap NestJS in standalone mode (no HTTP server)
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['log', 'error', 'warn'],
    });

    const videoService = app.get(VideoProcessingService);

    console.log('Starting pipeline...\n');
    const startTime = Date.now();

    const result = await videoService.process(inputPath);

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('═'.repeat(60));

    if (result.success) {
      // Move output to same directory as input
      const inputDir = path.dirname(inputPath);
      const inputName = path.basename(inputPath, path.extname(inputPath));
      const finalOutputPath = path.join(inputDir, `${inputName}_processed.mp4`);

      // Copy from temp to final location
      if (result.outputPath !== finalOutputPath) {
        fs.copyFileSync(result.outputPath, finalOutputPath);
        // Clean up temp file
        try {
          fs.unlinkSync(result.outputPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      console.log('SUCCESS');
      console.log('═'.repeat(60));
      console.log(`Output: ${finalOutputPath}`);
      console.log(`Time:   ${durationSec}s`);
      console.log('');
      console.log('Step Results:');
      console.log(
        `  Enhance: ${result.steps.enhance.success ? '✓' : '✗'} (${(result.steps.enhance.durationMs / 1000).toFixed(1)}s)`,
      );
      console.log(
        `  Logo:    ${result.steps.logo.success ? '✓' : '✗'} (${(result.steps.logo.durationMs / 1000).toFixed(1)}s)`,
      );
      console.log(
        `  Upscale: ${result.steps.upscale.success ? '✓' : result.steps.upscale.skipped ? '⊘ skipped' : '✗'} (${(result.steps.upscale.durationMs / 1000).toFixed(1)}s)`,
      );
    } else {
      console.log('FAILED');
      console.log('═'.repeat(60));
      console.log(`Error: ${result.error}`);
      console.log(`Time:  ${durationSec}s`);
    }

    await app.close();
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('');
    console.error('═'.repeat(60));
    console.error('FATAL ERROR');
    console.error('═'.repeat(60));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
