import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { IngestionModule } from './ingestion/ingestion.module';
import { LoginsModule } from './logins/logins.module';
import { ConfigModule } from './config/config.module';
import { FeaturesModule } from './features/features.module';
import { RulesModule } from './rules/rules.module';
import { RiskModule } from './risk/risk.module';
import { MlModule } from './ml/ml.module';
import { UsersModule } from './users/users.module';
import { ExplanationsModule } from './explanations/explanations.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { DatasetsModule } from './datasets/datasets.module';
import { DetectionModule } from './detection/detection.module';
import { AiModule } from './ai/ai.module';
import { JwtAuthGuard, RolesGuard } from './auth/auth.guards';

function buildOrmConfig(): TypeOrmModuleOptions {
  const common = {
    autoLoadEntities: true,
    synchronize: process.env.NODE_ENV !== 'production',
  };

  if (process.env.DATABASE_TYPE === 'postgres') {
    return {
      ...common,
      type: 'postgres',
      url:
        process.env.DATABASE_URL ||
        'postgresql://postgres:postgres@localhost:5432/sentry_login',
      ssl: { rejectUnauthorized: false },
    };
  }

  // SQLite (default dev database — no Postgres/Docker on this machine)
  const dbPath = process.env.DATABASE_PATH || 'db/sentry.sqlite';
  mkdirSync(dirname(dbPath), { recursive: true });
  return {
    ...common,
    type: 'sqlite',
    database: dbPath,
  };
}

@Module({
  imports: [
    TypeOrmModule.forRoot(buildOrmConfig()),
    AuthModule,
    DatasetsModule,
    DetectionModule,
    IngestionModule,
    LoginsModule,
    ConfigModule,
    FeaturesModule,
    RulesModule,
    RiskModule,
    MlModule,
    UsersModule,
    ExplanationsModule,
    AlertsModule,
    AiModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
