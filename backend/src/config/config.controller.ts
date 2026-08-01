import { Controller, Get, Put, Body } from '@nestjs/common';
import { ConfigService } from './config.service';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get('rules')
  async getRules() {
    return this.configService.getRules();
  }

  @Put('rules')
  async updateRules(@Body() rules: Record<string, number>) {
    return this.configService.updateRules(rules);
  }
}
