import { Controller, Get, Param, Query } from '@nestjs/common';
import { LoginsService, LoginsQuery } from './logins.service';

@Controller('logins')
export class LoginsController {
  constructor(private readonly loginsService: LoginsService) {}

  @Get('stats')
  async stats(@Query('datasetId') datasetId?: string) {
    return this.loginsService.getStats(datasetId || undefined);
  }

  @Get('trend')
  async trend(
    @Query('datasetId') datasetId?: string,
    @Query('bucket') bucket?: string,
    @Query('range') range?: string,
  ) {
    return this.loginsService.getTrend(
      datasetId || undefined,
      bucket || 'hour',
      range ? Number(range) : 24,
    );
  }

  @Get('heatmap')
  async heatmap(@Query('datasetId') datasetId?: string) {
    return this.loginsService.getHeatmap(datasetId || undefined);
  }

  @Get('top')
  async top(@Query('datasetId') datasetId?: string, @Query('limit') limit?: string) {
    return this.loginsService.getTop(datasetId || undefined, limit ? Number(limit) : 10);
  }

  @Get('box')
  async box(@Query('datasetId') datasetId?: string, @Query('bucket') bucket?: string) {
    return this.loginsService.getBox(datasetId || undefined, bucket || 'day');
  }

  @Get('scatter')
  async scatter(@Query('datasetId') datasetId?: string, @Query('limit') limit?: string) {
    return this.loginsService.getScatter(datasetId || undefined, limit ? Number(limit) : 500);
  }

  @Get()
  async findAll(@Query() query: LoginsQuery) {
    return this.loginsService.findAll({
      page: +query.page || 1,
      limit: +query.limit || 50,
      risk: query.risk,
      user: query.user,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      datasetId: query.datasetId || undefined,
      sortBy: query.sortBy || 'timestamp',
      sortOrder: query.sortOrder === 'ASC' ? 'ASC' : 'DESC',
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.loginsService.findOne(id);
  }
}
