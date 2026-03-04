import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FfmpegLogoService } from './ffmpeg-logo.service';
import * as fs from 'fs';

interface LogoRequestDto {
  inputPath: string;
}

interface LogoResponseDto {
  success: boolean;
  outputPath?: string;
  error?: string;
}

@Controller('logo')
export class LogoController {
  constructor(private readonly ffmpegLogoService: FfmpegLogoService) {}

  @Post()
  async applyLogo(@Body() body: LogoRequestDto): Promise<LogoResponseDto> {
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
      const outputPath = await this.ffmpegLogoService.applyLogo(inputPath);
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
