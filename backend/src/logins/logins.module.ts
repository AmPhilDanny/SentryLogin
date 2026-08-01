import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoginsController } from './logins.controller';
import { LoginsService } from './logins.service';
import { Login } from './login.entity';
import { User } from './user.entity';
import { UserFeature } from './user-feature.entity';
import { RuleHit } from './rule-hit.entity';
import { RiskScore } from './risk-score.entity';
import { ExplanationsModule } from '../explanations/explanations.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Login, User, UserFeature, RuleHit, RiskScore]),
    ExplanationsModule,
    ConfigModule,
  ],
  controllers: [LoginsController],
  providers: [LoginsService],
  exports: [LoginsService, TypeOrmModule],
})
export class LoginsModule {}
