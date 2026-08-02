import { Controller, Get, Put, Body } from '@nestjs/common';
import { ConfigService } from './config.service';
import { Roles } from '../auth/auth.guards';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get('rules')
  async getRules() {
    return this.configService.getRules();
  }

  @Put('rules')
  @Roles('manager', 'super_admin')
  async updateRules(@Body() rules: Record<string, number>) {
    return this.configService.updateRules(rules);
  }
}
