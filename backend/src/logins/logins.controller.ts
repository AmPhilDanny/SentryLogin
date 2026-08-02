import { Controller, Get, Param, Query } from '@nestjs/common';
import { LoginsService, LoginsQuery } from './logins.service';

@Controller('logins')
export class LoginsController {
  constructor(private readonly loginsService: LoginsService) {}

  @Get('stats')
  async stats(@Query('datasetId') datasetId?: string) {
    return this.loginsService.getStats(datasetId || undefined);
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
