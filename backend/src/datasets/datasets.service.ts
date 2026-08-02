import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';
import { Dataset } from './dataset.entity';
import { Login } from '../logins/login.entity';
import { RuleHit } from '../logins/rule-hit.entity';
import { RiskScore } from '../logins/risk-score.entity';
import { UserFeature } from '../logins/user-feature.entity';
import { AiExplanation } from '../explanations/ai-explanation.entity';
import { Alert } from '../alerts/alert.entity';
import { User } from '../logins/user.entity';
import { FeaturesService, LoginEvent } from '../features/features.service';
import { RulesService, riskLabel } from '../rules/rules.service';
import { ConfigService } from '../config/config.service';
import {
  DetectionResult,
  DetectionService,
  LoginRow,
} from '../detection/detection.service';

export interface DatasetPreview {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  total: number;
}

export interface DatasetHead {
  columns: string[];
  rows: string[][];
  hasHeader: boolean;
  total: number;
}

export interface UploadResult {
  datasetId: string;
  filename: string;
  rowCount: number;
  status: string;
  detection: DetectionResult;
}

const CSV_COLUMNS = ['username', 'timestamp', 'ip', 'country', 'city', 'device', 'browser', 'success'];

const MAX_STUCK_MS = 20 * 60 * 1000;

type StageCallback = (stage: string, progress: number) => Promise<void>;

@Injectable()
export class DatasetsService {
  constructor(
    @InjectRepository(Dataset) private readonly datasetRepo: Repository<Dataset>,
    @InjectRepository(Login) private readonly loginRepo: Repository<Login>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserFeature)
    private readonly featureRepo: Repository<UserFeature>,
    @InjectRepository(RuleHit) private readonly ruleHitRepo: Repository<RuleHit>,
    @InjectRepository(RiskScore)
    private readonly riskScoreRepo: Repository<RiskScore>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly detectionService: DetectionService,
    private readonly featuresService: FeaturesService,
    private readonly rulesService: RulesService,
    private readonly configService: ConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // Stage 1 — upload & store
  // -------------------------------------------------------------------------

  async createFromUpload(
    filename: string,
    createdBy: string | null,
    buffer: Buffer,
  ): Promise<UploadResult> {
    const detection = this.detectionService.detect(buffer);
    const dataset = this.datasetRepo.create({
      filename,
      createdBy,
      rowCount: detection.totalRows,
      importedCount: 0,
      flaggedCount: 0,
      status: 'uploaded',
      stage: null,
      progress: 0,
      detection: JSON.stringify(detection),
      rawCsv: buffer.toString('utf-8').replace(/^\uFEFF/, ''),
    });
    const saved = await this.datasetRepo.save(dataset);
    return {
      datasetId: saved.id,
      filename: saved.filename,
      rowCount: saved.rowCount,
      status: saved.status,
      detection,
    };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list() {
    const datasets = await this.datasetRepo.find({ order: { createdAt: 'DESC' } });
    return datasets.map((d) => this.toListItem(d));
  }

  async getDetail(id: string) {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) throw new NotFoundException(`Dataset ${id} not found`);
    return this.toListItem(dataset);
  }

  async head(id: string, limit = 30): Promise<DatasetHead> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) throw new NotFoundException(`Dataset ${id} not found`);

    const raw = (dataset.rawCsv ?? '').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    let detection: DetectionResult | null = null;
    try {
      detection = dataset.detection ? JSON.parse(dataset.detection) : null;
    } catch {
      detection = null;
    }

    const n = Math.min(Math.max(limit, 1), 200);
    const parsed = parse(lines.slice(0, n + 1).join('\n'), {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
    }) as string[][];

    const hasHeader = detection?.hasHeader ?? false;
    const rows = hasHeader ? parsed.slice(1) : parsed;
    const columns =
      detection?.columns ??
      (parsed[0] ?? []).map((_, i) => `Column ${i + 1}`);

    return { columns, rows: rows.slice(0, n), hasHeader, total: detection?.totalRows ?? lines.length };
  }

  private toListItem(dataset: Dataset) {
    let detection: Pick<
      DetectionResult,
      'kind' | 'kindLabel' | 'confidence' | 'feedback' | 'canAnalyze' | 'hasHeader' | 'columns' | 'mapping'
    > | null = null;
    try {
      detection = dataset.detection ? JSON.parse(dataset.detection) : null;
    } catch {
      detection = null;
    }
    return {
      id: dataset.id,
      filename: dataset.filename,
      rowCount: dataset.rowCount,
      importedCount: dataset.importedCount,
      flaggedCount: dataset.flaggedCount,
      createdAt: dataset.createdAt,
      createdBy: dataset.createdBy,
      status: dataset.status,
      stage: dataset.stage,
      progress: dataset.progress,
      error: dataset.error,
      detection,
    };
  }

  // -------------------------------------------------------------------------
  // Stage 2 — analysis job
  // -------------------------------------------------------------------------

  async startAnalysis(id: string): Promise<{ started: boolean }> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) throw new NotFoundException(`Dataset ${id} not found`);

    if (!dataset.rawCsv) {
      throw new BadRequestException(
        'This dataset predates two-stage upload — delete it and re-upload the file.',
      );
    }

    if (dataset.status === 'analyzing') {
      const stuck =
        Date.now() - new Date(dataset.updatedAt).getTime() > MAX_STUCK_MS;
      if (!stuck) {
        throw new ConflictException('Analysis is already running for this dataset');
      }
      dataset.status = 'failed';
      dataset.error = 'Previous analysis was interrupted — retry.';
      dataset.stage = null;
      await this.datasetRepo.save(dataset);
    }

    let detection: DetectionResult | null = null;
    try {
      detection = dataset.detection ? JSON.parse(dataset.detection) : null;
    } catch {
      detection = null;
    }

    if (!detection?.canAnalyze) {
      const feedback = detection?.feedback?.join(' ') ?? 'No login-related columns detected.';
      throw new BadRequestException(
        `This file cannot be analyzed as a login log. ${feedback}`,
      );
    }

    dataset.status = 'analyzing';
    dataset.stage = 'Queued';
    dataset.progress = 1;
    dataset.error = null;
    await this.datasetRepo.save(dataset);

    // Run in-process; the request returns immediately so the UI can poll progress.
    void this.runAnalysis(id).catch(() => undefined);
    return { started: true };
  }

  private async runAnalysis(id: string): Promise<void> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) return;

    const setStage: StageCallback = async (stage, progress) => {
      await this.datasetRepo.update(id, { stage, progress });
    };

    try {
      await setStage('Parsing file', 5);
      const content = dataset.rawCsv ?? '';
      const parsed = parse(content, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
      }) as string[][];

      let detection: DetectionResult;
      try {
        detection = JSON.parse(dataset.detection ?? 'null');
      } catch {
        detection = null as unknown as DetectionResult;
      }
      if (!detection) throw new Error('Missing detection metadata');

      await setStage('Mapping columns', 12);
      const { rows, skipped } = this.detectionService.extractRows(parsed, detection);

      if (rows.length === 0) {
        const reasons = [...new Set(skipped.slice(0, 5).map((s) => s.reason))].join('; ');
        throw new Error(
          `No rows could be mapped to login events. ${reasons ? `Skipped: ${reasons}.` : ''}`,
        );
      }

      await setStage('Computing features & rules', 25);
      const result = await this.persistAndAnalyze(rows, id, (progress) => {
        void setStage('Computing features & rules', progress);
      });
      const { imported, flagged } = result;

      await setStage('Finalizing', 97);
      await this.datasetRepo.update(id, {
        status: 'complete',
        stage: 'Done',
        progress: 100,
        rowCount: detection.totalRows,
        importedCount: imported,
        flaggedCount: flagged,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.datasetRepo.update(id, {
        status: 'failed',
        stage: null,
        error: message,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Pipeline core (features → rules → risk scores → persist)
  // -------------------------------------------------------------------------

  private async persistAndAnalyze(
    rows: LoginRow[],
    datasetId: string,
    onProgress?: (progress: number) => void,
  ): Promise<{ imported: number; flagged: number }> {
    const userById = await this.ensureUsers(rows.map((r) => r.username));
    const config = this.configService.getRules();

    const byUser = new Map<string, LoginRow[]>();
    for (const row of rows) {
      const list = byUser.get(row.username) ?? [];
      list.push(row);
      byUser.set(row.username, list);
    }
    const totalUsers = byUser.size;

    const logins: Login[] = [];
    const features: UserFeature[] = [];
    const ruleHits: RuleHit[] = [];
    const riskScores: RiskScore[] = [];
    let flagged = 0;
    let processedUsers = 0;

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

      processedUsers += 1;
      if (onProgress && processedUsers % 25 === 0) {
        const pct = Math.min(25 + Math.floor((65 * processedUsers) / totalUsers), 90);
        onProgress(pct);
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

  // -------------------------------------------------------------------------
  // Preview / export / delete
  // -------------------------------------------------------------------------

  async getWithRows(id: string, limit = 50): Promise<DatasetPreview> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) throw new NotFoundException(`Dataset ${id} not found`);

    const total = await this.loginRepo.count({ where: { datasetId: id } });
    const logins = await this.loginRepo.find({
      where: { datasetId: id },
      relations: ['user'],
      take: Math.min(Math.max(limit, 1), 200),
      order: { timestamp: 'DESC' },
    });

    const rows = logins.map((l) => [
      l.user?.username ?? l.userId,
      l.timestamp.toISOString(),
      l.ip,
      l.country,
      l.city,
      l.device,
      l.browser,
      l.success,
    ]);

    return { columns: CSV_COLUMNS, rows, total };
  }

  async toCsv(id: string): Promise<{ filename: string; csv: string }> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) throw new NotFoundException(`Dataset ${id} not found`);

    const logins = await this.loginRepo.find({
      where: { datasetId: id },
      relations: ['user'],
      order: { timestamp: 'ASC' },
    });

    const escape = (value: unknown): string => {
      const s = String(value ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [CSV_COLUMNS.join(',')];
    for (const l of logins) {
      lines.push(
        [
          l.user?.username ?? l.userId,
          l.timestamp.toISOString(),
          l.ip,
          l.country,
          l.city,
          l.device,
          l.browser,
          l.success,
        ]
          .map(escape)
          .join(','),
      );
    }
    return { filename: dataset.filename, csv: lines.join('\n') };
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) throw new NotFoundException(`Dataset ${id} not found`);
    if (dataset.status === 'analyzing') {
      throw new ConflictException('Cannot delete a dataset while it is being analyzed');
    }

    await this.dataSource.transaction(async (manager) => {
      const logins = await manager.find(Login, {
        where: { datasetId: id },
        select: ['id'],
      });
      const loginIds = logins.map((l) => l.id);
      if (loginIds.length > 0) {
        await manager.delete(RuleHit, { loginId: In(loginIds) });
        await manager.delete(RiskScore, { loginId: In(loginIds) });
        await manager.delete(UserFeature, { loginId: In(loginIds) });
        await manager.delete(AiExplanation, { loginId: In(loginIds) });
        await manager.delete(Alert, { loginId: In(loginIds) });
        await manager.delete(Login, { id: In(loginIds) });
      }
      await manager.delete(Dataset, { id });
    });

    return { deleted: true };
  }
}
