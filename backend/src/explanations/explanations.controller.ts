import { Controller, Get, Param, Post } from '@nestjs/common';
import { ExplanationsService } from './explanations.service';

@Controller('explanations')
export class ExplanationsController {
  constructor(private readonly explanationsService: ExplanationsService) {}

  @Post('backfill')
  async backfill() {
    return this.explanationsService.backfill();
  }

  @Get(':loginId')
  async get(@Param('loginId') loginId: string) {
    return this.explanationsService.getForLogin(loginId);
  }
}
