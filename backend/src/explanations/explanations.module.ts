import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExplanationsController } from './explanations.controller';
import { ExplanationsService } from './explanations.service';
import { AiExplanation } from './ai-explanation.entity';
import { Login } from '../logins/login.entity';
import { RiskScore } from '../logins/risk-score.entity';
import { UsersModule } from '../users/users.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiExplanation, Login, RiskScore]),
    UsersModule,
    ConfigModule,
  ],
  controllers: [ExplanationsController],
  providers: [ExplanationsService],
  exports: [ExplanationsService],
})
export class ExplanationsModule {}
