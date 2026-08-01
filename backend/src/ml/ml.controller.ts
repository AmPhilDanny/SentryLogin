import { Controller, Get, Post } from '@nestjs/common';
import { MlService, MlStatus, TrainSummary } from './ml.service';

@Controller('ml')
export class MlController {
  constructor(private readonly mlService: MlService) {}

  @Post('train')
  async train(): Promise<TrainSummary> {
    return this.mlService.trainOnDatabase();
  }

  @Get('status')
  async status(): Promise<MlStatus> {
    return this.mlService.status();
  }
}
