import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ReplicateUpscaleService,
  UpscaleResult,
} from './replicate-upscale.service';
import * as fs from 'fs';

interface UpscaleRequestDto {
  inputPath: string;
}

interface UpscaleResponseDto {
  success: boolean;
  outputPath: string;
  upscaled: boolean;
  error?: string;
}

@Controller('upscale')
export class UpscaleController {
  constructor(
    private readonly replicateUpscaleService: ReplicateUpscaleService,
  ) {}

  @Post()
  async upscale(@Body() body: UpscaleRequestDto): Promise<UpscaleResponseDto> {
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

    const result: UpscaleResult =
      await this.replicateUpscaleService.upscale(inputPath);

    return {
      success: result.upscaled,
      outputPath: result.outputPath,
      upscaled: result.upscaled,
      error: result.error,
    };
  }
}
