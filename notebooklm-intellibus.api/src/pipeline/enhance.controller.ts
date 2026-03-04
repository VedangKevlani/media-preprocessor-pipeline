import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FfmpegEnhanceService } from './ffmpeg-enhance.service';
import * as fs from 'fs';

interface EnhanceRequestDto {
  inputPath: string;
}

interface EnhanceResponseDto {
  success: boolean;
  outputPath?: string;
  error?: string;
}

@Controller('enhance')
export class EnhanceController {
  constructor(private readonly ffmpegEnhanceService: FfmpegEnhanceService) {}

  @Post()
  async enhance(@Body() body: EnhanceRequestDto): Promise<EnhanceResponseDto> {
    const { inputPath } = body;

    if (!inputPath) {
      throw new HttpException('inputPath is required', HttpStatus.BAD_REQUEST);
    }

    // Verify input file exists
    if (!fs.existsSync(inputPath)) {
      throw new HttpException(
        `Input file not found: ${inputPath}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const outputPath = await this.ffmpegEnhanceService.enhance(inputPath);
      return {
        success: true,
        outputPath,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
