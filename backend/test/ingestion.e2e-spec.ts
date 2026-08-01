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

describe('Ingestion E2E', () => {
  let app: INestApplication;

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

  it('uploads CSV, computes features, rules and risk scores', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ingest/csv')
      .attach('file', Buffer.from(SAMPLE_CSV), 'sample.csv')
      .expect(201);

    expect(res.body).toEqual({
      total: 8,
      valid: 7,
      imported: 7,
      flagged: 6,
      errors: [{ row: 8, message: 'Missing columns: ip' }],
    });
  });

  it('stores rule hits and risk scores for flagged logins', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/logins?user=alice&limit=50')
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
      .expect(200);

    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].riskScore.label).toBe('Low');
    expect(list.body.data[0].riskScore.finalScore).toBe(0);
  });
});
