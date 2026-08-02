import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IngestionService } from './ingestion.service';
import { Roles } from '../auth/auth.guards';

@Controller('ingest')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('csv')
  @UseInterceptors(FileInterceptor('file'))
  @Roles('manager', 'super_admin')
  async uploadCsv(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: { user?: { email: string } },
  ) {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    const results = await this.ingestionService.processCsv(
      file.buffer,
      file.originalname,
      req.user?.email ?? null,
    );
    return results;
  }
}
