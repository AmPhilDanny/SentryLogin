import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { DatasetsService } from './datasets.service';
import { Roles } from '../auth/auth.guards';

@Controller('datasets')
export class DatasetsController {
  constructor(private readonly datasetsService: DatasetsService) {}

  @Get()
  list() {
    return this.datasetsService.list();
  }

  @Get(':id/preview')
  preview(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.datasetsService.getWithRows(id, limit ? Number(limit) : 50);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { filename, csv } = await this.datasetsService.toCsv(id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    res.send(csv);
  }

  @Roles('super_admin')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.datasetsService.remove(id);
  }
}
