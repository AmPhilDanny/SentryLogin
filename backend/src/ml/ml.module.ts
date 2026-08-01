import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MlController } from './ml.controller';
import { MlService } from './ml.service';
import { UserFeature } from '../logins/user-feature.entity';
import { RiskScore } from '../logins/risk-score.entity';
import { ConfigModule } from '../config/config.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserFeature, RiskScore]),
    ConfigModule,
    RiskModule,
  ],
  controllers: [MlController],
  providers: [MlService],
  exports: [MlService],
})
export class MlModule {}
