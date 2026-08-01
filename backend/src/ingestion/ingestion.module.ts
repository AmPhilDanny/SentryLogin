import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { Login } from '../logins/login.entity';
import { User } from '../logins/user.entity';
import { UserFeature } from '../logins/user-feature.entity';
import { RuleHit } from '../logins/rule-hit.entity';
import { RiskScore } from '../logins/risk-score.entity';
import { FeaturesModule } from '../features/features.module';
import { RulesModule } from '../rules/rules.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Login, User, UserFeature, RuleHit, RiskScore]),
    FeaturesModule,
    RulesModule,
    ConfigModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
