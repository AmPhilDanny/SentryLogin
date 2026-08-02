import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatasetsController } from './datasets.controller';
import { DatasetsService } from './datasets.service';
import { Dataset } from './dataset.entity';
import { Login } from '../logins/login.entity';
import { User } from '../logins/user.entity';
import { RuleHit } from '../logins/rule-hit.entity';
import { RiskScore } from '../logins/risk-score.entity';
import { UserFeature } from '../logins/user-feature.entity';
import { AiExplanation } from '../explanations/ai-explanation.entity';
import { Alert } from '../alerts/alert.entity';
import { DetectionModule } from '../detection/detection.module';
import { FeaturesModule } from '../features/features.module';
import { RulesModule } from '../rules/rules.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Dataset,
      Login,
      User,
      RuleHit,
      RiskScore,
      UserFeature,
      AiExplanation,
      Alert,
    ]),
    DetectionModule,
    FeaturesModule,
    RulesModule,
    ConfigModule,
  ],
  controllers: [DatasetsController],
  providers: [DatasetsService],
  exports: [DatasetsService],
})
export class DatasetsModule {}
