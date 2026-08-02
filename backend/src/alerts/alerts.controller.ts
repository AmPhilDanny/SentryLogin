import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { AlertsService, AlertQuery } from './alerts.service';
import { AlertStatus } from './alert.entity';
import { Roles } from '../auth/auth.guards';

class UpdateAlertStatusDto {
  @IsIn(['open', 'dismissed', 'escalated'], {
    message: 'status must be one of: open, dismissed, escalated',
  })
  status!: AlertStatus;
}

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async findAll(@Query() query: AlertQuery) {
    return this.alertsService.findAll({
      status: query.status,
      page: +query.page || 1,
      limit: +query.limit || 50,
    });
  }

  @Patch(':loginId/status')
  @Roles('manager', 'super_admin')
  async updateStatus(
    @Param('loginId') loginId: string,
    @Body() body: UpdateAlertStatusDto,
  ) {
    return this.alertsService.updateStatus(loginId, body.status);
  }
}
