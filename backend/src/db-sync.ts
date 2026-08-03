/**
 * One-shot schema migration for production (Render + Supabase).
 * Creates/updates tables to match the TypeORM entities, bypassing the
 * dev-only `synchronize` flag. Run BEFORE the app boots:
 *   npm run build && node dist/db-sync.js
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from './logins/user.entity';
import { Login } from './logins/login.entity';
import { UserFeature } from './logins/user-feature.entity';
import { RuleHit } from './logins/rule-hit.entity';
import { RiskScore } from './logins/risk-score.entity';
import { AiExplanation } from './explanations/ai-explanation.entity';
import { Alert } from './alerts/alert.entity';
import { AuthUser } from './auth/auth-user.entity';
import { Dataset } from './datasets/dataset.entity';
import { AiSettings } from './ai/ai-settings.entity';

const ENTITIES = [
  User,
  Login,
  UserFeature,
  RuleHit,
  RiskScore,
  AiExplanation,
  Alert,
  AuthUser,
  Dataset,
  AiSettings,
];

async function main(): Promise<void> {
  const isPostgres = process.env.DATABASE_TYPE === 'postgres';
  const options = isPostgres
    ? {
        type: 'postgres' as const,
        url:
          process.env.DATABASE_URL ||
          'postgresql://postgres:postgres@localhost:5432/sentry_login',
        ssl: { rejectUnauthorized: false },
      }
    : {
        type: 'sqlite' as const,
        database: process.env.DATABASE_PATH || 'db/sentry.sqlite',
      };

  const dataSource = new DataSource({
    ...options,
    entities: ENTITIES,
    synchronize: true,
  });
  await dataSource.initialize();
  console.log(
    `[db-sync] schema synchronized on ${isPostgres ? 'postgres' : 'sqlite'}`,
  );
  await dataSource.destroy();
}

main().catch((err: unknown) => {
  console.error('[db-sync] FAILED:', err);
  process.exit(1);
});
