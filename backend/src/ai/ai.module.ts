import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiSettings } from './ai-settings.entity';
import { AiSettingsService } from './ai-settings.service';
import { AiGatewayService } from './ai-gateway.service';
import { AiDescribeService } from './ai-describe.service';
import { AiController } from './ai.controller';
import { Dataset } from '../datasets/dataset.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AiSettings, Dataset])],
  controllers: [AiController],
  providers: [AiSettingsService, AiGatewayService, AiDescribeService],
  exports: [AiSettingsService, AiGatewayService],
})
export class AiModule {}