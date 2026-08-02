import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { rmSync } from 'fs';
import { AppModule } from '../src/app.module';

const SAMPLE_CSV = [
  'username,timestamp,ip,country,city,device,browser,success',
  // alice — 5 failed logins within 10 minutes from a blacklisted IP
  'alice,2026-01-05T14:00:00.000Z,185.220.101.71,RU,Moscow,Windows,Chrome,false',
  'alice,2026-01-05T14:01:00.000Z,185.220.101.71,RU,Moscow,Windows,Chrome,false',
  'alice,2026-01-05T14:02:00.000Z,185.220.101.71,RU,Moscow,Windows,Chrome,false',
  'alice,2026-01-05T14:03:00.000Z,185.220.101.71,RU,Moscow,Windows,Chrome,false',
  'alice,2026-01-05T14:04:00.000Z,185.220.101.71,RU,Moscow,Windows,Chrome,false',
  // alice — one more failure => burst threshold crossed (5 in window)
  'alice,2026-01-05T14:05:00.000Z,185.220.101.71,RU,Moscow,Windows,Chrome,false',
  // bob — clean login
  'bob,2026-01-05T14:30:00.000Z,8.8.8.8,US,New York,iPhone,Safari,true',
  // invalid row — empty ip column
  'carol,2026-01-05T15:00:00.000Z,,US,Chicago,Mac,Firefox,true',
].join('\n');

async function pollUntilComplete(
  app: INestApplication,
  token: string,
  id: string,
  timeoutMs = 15000,
): Promise<{ status: string; error: string | null; imported: number; flagged: number }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app.getHttpServer())
      .get(`/api/datasets/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const data = res.body;
    if (data.status === 'complete' || data.status === 'failed') {
      return {
        status: data.status,
        error: data.error,
        imported: data.importedCount,
        flagged: data.flaggedCount,
      };
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Analysis did not finish within ${timeoutMs}ms`);
}

describe('Ingestion E2E (two-stage)', () => {
  let app: INestApplication;
  let token: string;
  let datasetId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@sentry.local', password: 'Admin@1234' })
      .expect(201);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
    const dbPath = process.env.DATABASE_PATH;
    if (dbPath) {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(dbPath + suffix, { force: true });
      }
    }
  });

  it('stage 1: upload stores the file and detects the format (no analysis yet)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ingest/csv')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(SAMPLE_CSV), 'sample.csv')
      .expect(201);

    expect(res.body.status).toBe('uploaded');
    expect(res.body.datasetId).toBeDefined();
    expect(res.body.rowCount).toBe(8);
    expect(res.body.detection.hasHeader).toBe(true);
    expect(res.body.detection.kind).toBe('login_standard');
    expect(res.body.detection.canAnalyze).toBe(true);
    expect(res.body.detection.mapping.username.column).toBe('username');
    expect(res.body.detection.mapping.success.column).toBe('success');
    datasetId = res.body.datasetId;
  });

  it('stage 2: analyze runs as a tracked job that completes', async () => {
    const start = await request(app.getHttpServer())
      .post(`/api/datasets/${datasetId}/analyze`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(start.body.started).toBe(true);

    const done = await pollUntilComplete(app, token, datasetId);
    expect(done.status).toBe('complete');
    expect(done.error).toBeNull();
    expect(done.imported).toBe(7);
    expect(done.flagged).toBe(6);
  });

  it('stores rule hits and risk scores for flagged logins', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/logins?user=alice&limit=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(list.body.data).toHaveLength(6);
    const aliceRows = list.body.data;
    for (const row of aliceRows) {
      expect(row.riskScore.label).toBeDefined();
    }

    // The 6th alice login: burst + blacklisted IP => Critical (85)
    const burstRow = aliceRows.find(
      (r: { riskScore: { label: string } }) => r.riskScore.label === 'Critical',
    );
    expect(burstRow).toBeDefined();

    const detail = await request(app.getHttpServer())
      .get(`/api/logins/${burstRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(detail.body.features).toBeDefined();
    expect(detail.body.features.failedAttemptsInWindow).toBe(5);
    const ruleNames = detail.body.ruleHits.map(
      (h: { ruleName: string; triggered: boolean }) => h.ruleName,
    );
    expect(ruleNames).toContain('failed_login_burst');
    expect(ruleNames).toContain('blacklisted_ip');
    expect(
      detail.body.ruleHits.find(
        (h: { ruleName: string }) => h.ruleName === 'blacklisted_ip',
      ).triggered,
    ).toBe(true);
  });

  it('scores clean logins as Low', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/logins?user=bob&limit=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].riskScore.label).toBe('Low');
    expect(list.body.data[0].riskScore.finalScore).toBe(0);
  });
});
