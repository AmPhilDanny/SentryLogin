import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { AlertsService, AlertQuery } from './alerts.service';
import { AlertStatus, AlertResolution } from './alert.entity';
import { Roles, JwtUser } from '../auth/auth.guards';

const STATUSES: AlertStatus[] = [
  'open',
  'dismissed',
  'escalated',
  'investigated',
  'resolved',
];
const RESOLUTIONS: AlertResolution[] = [
  'fraud',
  'positive',
  'false_positive',
  'no_action',
];

class UpdateAlertStatusDto {
  @IsIn(STATUSES, {
    message: 'status must be one of: open, dismissed, escalated, investigated, resolved',
  })
  status!: AlertStatus;
}

class ResolveAlertDto {
  @IsIn(RESOLUTIONS, {
    message: 'resolution must be one of: fraud, positive, false_positive, no_action',
  })
  resolution!: AlertResolution;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
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

  @Patch(':loginId/resolve')
  @Roles('manager', 'super_admin')
  async resolve(
    @Param('loginId') loginId: string,
    @Body() body: ResolveAlertDto,
    @Req() req: Request & { user?: JwtUser },
  ) {
    return this.alertsService.resolve(
      loginId,
      body.resolution,
      body.notes ?? null,
      req.user?.sub ?? 'system',
    );
  }
}