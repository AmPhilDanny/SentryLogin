import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { Login } from '../logins/login.entity';
import { User } from '../logins/user.entity';
import { UserFeature } from '../logins/user-feature.entity';
import { RuleHit } from '../logins/rule-hit.entity';
import { RiskScore } from '../logins/risk-score.entity';
import { FeaturesService, LoginEvent } from '../features/features.service';
import { RulesService, riskLabel } from '../rules/rules.service';
import { ConfigService } from '../config/config.service';
import { DatasetsService } from '../datasets/datasets.service';

export interface LoginRow {
  username: string;
  timestamp: string;
  ip: string;
  country: string;
  city: string;
  device: string;
  browser: string;
  success: string;
}

export interface IngestSummary {
  total: number;
  valid: number;
  errors: { row: number; message: string }[];
  imported: number;
  flagged: number;
  datasetId: string;
}

const REQUIRED_COLUMNS = [
  'username',
  'timestamp',
  'ip',
  'country',
  'city',
  'device',
  'browser',
  'success',
];

@Injectable()
export class IngestionService {
  constructor(
    @InjectRepository(Login) private readonly loginRepo: Repository<Login>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserFeature)
    private readonly featureRepo: Repository<UserFeature>,
    @InjectRepository(RuleHit) private readonly ruleHitRepo: Repository<RuleHit>,
    @InjectRepository(RiskScore)
    private readonly riskScoreRepo: Repository<RiskScore>,
    private readonly featuresService: FeaturesService,
    private readonly rulesService: RulesService,
    private readonly configService: ConfigService,
    private readonly datasetsService: DatasetsService,
  ) {}

  async processCsv(
    buffer: Buffer,
    filename: string,
    createdBy: string | null,
  ): Promise<IngestSummary> {
    const content = buffer.toString('utf-8');
    const rows: Record<string, string>[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    });

    const valid: LoginRow[] = [];
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const missing = REQUIRED_COLUMNS.filter((col) => !row[col]);
      if (missing.length > 0) {
        errors.push({ row: i + 1, message: `Missing columns: ${missing.join(', ')}` });
        continue;
      }
      valid.push({
        username: row.username,
        timestamp: row.timestamp,
        ip: row.ip,
        country: row.country,
        city: row.city,
        device: row.device,
        browser: row.browser,
        success: row.success,
      });
    }

    const dataset = await this.datasetsService.create(filename, createdBy);
    const { imported, flagged } = await this.persistAndAnalyze(valid, dataset.id);
    await this.datasetsService.finalize(dataset.id, rows.length, imported, flagged);

    return {
      total: rows.length,
      valid: valid.length,
      errors,
      imported,
      flagged,
      datasetId: dataset.id,
    };
  }

  private async persistAndAnalyze(
    rows: LoginRow[],
    datasetId: string,
  ): Promise<{ imported: number; flagged: number }> {
    const userById = await this.ensureUsers(rows.map((r) => r.username));
    const config = this.configService.getRules();

    const byUser = new Map<string, LoginRow[]>();
    for (const row of rows) {
      const list = byUser.get(row.username) ?? [];
      list.push(row);
      byUser.set(row.username, list);
    }

    const logins: Login[] = [];
    const features: UserFeature[] = [];
    const ruleHits: RuleHit[] = [];
    const riskScores: RiskScore[] = [];
    let flagged = 0;

    for (const [username, userRows] of byUser) {
      userRows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const history: LoginEvent[] = [];

      for (const row of userRows) {
        const timestamp = new Date(row.timestamp);
        if (Number.isNaN(timestamp.getTime())) {
          continue;
        }

        const event: LoginEvent = {
          username,
          timestamp,
          ip: row.ip,
          country: row.country,
          city: row.city,
          device: row.device,
          browser: row.browser,
          success: row.success.toLowerCase() === 'true',
        };

        const loginId = randomUUID();
        const login = new Login();
        login.id = loginId;
        login.userId = userById.get(username)!;
        login.timestamp = timestamp;
        login.ip = row.ip;
        login.country = row.country;
        login.city = row.city;
        login.device = row.device;
        login.browser = row.browser;
        login.success = event.success;
        login.datasetId = datasetId;
        logins.push(login);

        const computed = this.featuresService.compute(event, history);
        const feature = new UserFeature();
        feature.loginId = loginId;
        feature.loginHour = computed.login_hour;
        feature.dayOfWeek = computed.day_of_week;
        feature.failedAttemptsInWindow = computed.failed_attempts_in_window;
        feature.countryChange = computed.country_change === 1;
        feature.deviceChange = computed.device_change === 1;
        feature.browserChange = computed.browser_change === 1;
        feature.ipChange = computed.ip_change === 1;
        feature.geoDistanceKm = computed.geo_distance_km;
        feature.accountLoginFrequency = computed.account_login_frequency;
        feature.historicalSuccessRate = computed.historical_success_rate;
        features.push(feature);

        const evaluation = this.rulesService.evaluate(event, computed, history, config);
        for (const hit of evaluation.hits) {
          const entity = new RuleHit();
          entity.loginId = loginId;
          entity.ruleName = hit.ruleName;
          entity.triggered = hit.triggered;
          entity.details = hit.details ?? null;
          entity.score = hit.score;
          ruleHits.push(entity);
        }

        const riskScore = new RiskScore();
        riskScore.loginId = loginId;
        riskScore.ruleScore = evaluation.score;
        riskScore.mlScore = null;
        riskScore.totalScore = evaluation.score;
        riskScore.label = riskLabel(evaluation.score);
        riskScores.push(riskScore);

        history.push(event);
        if (evaluation.score >= 40) {
          flagged += 1;
        }
      }
    }

    const queryRunner = this.loginRepo.manager.connection.createQueryRunner();
    try {
      await queryRunner.connect();
      const dbType = this.loginRepo.manager.connection.options.type;
      if (dbType === 'sqlite') {
        await queryRunner.query('PRAGMA journal_mode = WAL');
        await queryRunner.query('PRAGMA synchronous = NORMAL');
      }
      await queryRunner.startTransaction();
      await this.bulkInsert(queryRunner, this.loginRepo, logins);
      await this.bulkInsert(queryRunner, this.featureRepo, features);
      await this.bulkInsert(queryRunner, this.ruleHitRepo, ruleHits);
      await this.bulkInsert(queryRunner, this.riskScoreRepo, riskScores);
      await queryRunner.commitTransaction();
    } catch (error) {
      try {
        await queryRunner.rollbackTransaction();
      } catch {
        // Connection may already be dead (e.g. pooler dropped it) — the
        // original error below is the one that matters.
      }
      throw error;
    } finally {
      await queryRunner.release();
    }

    return { imported: logins.length, flagged };
  }

  private async bulkInsert<T extends object>(
    queryRunner: import('typeorm').QueryRunner,
    repo: Repository<T>,
    entities: T[],
    chunkSize = 400,
  ): Promise<void> {
    for (let i = 0; i < entities.length; i += chunkSize) {
      const chunk = entities.slice(i, i + chunkSize);
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(repo.target)
        .values(chunk as unknown as T[])
        .execute();
    }
  }

  private async ensureUsers(usernames: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(usernames)];
    const existing = await this.userRepo.find({
      where: unique.map((username) => ({ username })),
    });
    const userById = new Map(existing.map((u) => [u.username, u.id]));

    const missing = unique
      .filter((username) => !userById.has(username))
      .map((username) => {
        const user = new User();
        user.username = username;
        return user;
      });
    if (missing.length > 0) {
      const saved = await this.userRepo.save(missing);
      for (const u of saved) {
        userById.set(u.username, u.id);
      }
    }
    return userById;
  }
}
