import { tmpdir } from 'os';
import { join } from 'path';

// Isolated SQLite DB per test run — never touches the dev database.
process.env.DATABASE_PATH = join(tmpdir(), `sentry-e2e-${Date.now()}.sqlite`);
process.env.NODE_ENV = 'test';
