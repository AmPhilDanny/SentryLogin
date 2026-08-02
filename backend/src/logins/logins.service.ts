import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Login } from './login.entity';
import { RiskScore } from './risk-score.entity';
import { RuleHit } from './rule-hit.entity';
import { UserFeature } from './user-feature.entity';
import { ExplanationsService } from '../explanations/explanations.service';
import { ConfigService } from '../config/config.service';

export interface LoginsQuery {
  page: number;
  limit: number;
  risk?: string;
  user?: string;
  dateFrom?: string;
  dateTo?: string;
  datasetId?: string;
  sortBy: string;
  sortOrder: 'ASC' | 'DESC';
}

const MAX_LIMIT = 200;
const VALID_RISK = ['Low', 'Medium', 'High', 'Critical'];
const SORT_COLUMNS: Record<string, string> = {
  timestamp: 'login.timestamp',
  score: 'risk.totalScore',
  label: 'risk.label',
  user: 'user.username',
  ip: 'login.ip',
  country: 'login.country',
};

@Injectable()
export class LoginsService {
  constructor(
    @InjectRepository(Login) private readonly loginRepo: Repository<Login>,
    @InjectRepository(RiskScore)
    private readonly riskScoreRepo: Repository<RiskScore>,
    @InjectRepository(UserFeature)
    private readonly featureRepo: Repository<UserFeature>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly explanationsService: ExplanationsService,
    private readonly configService: ConfigService,
  ) {}

  async findAll(query: LoginsQuery) {
    const page = Math.max(1, Math.floor(query.page) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit) || 50));

    const qb = this.loginRepo
      .createQueryBuilder('login')
      .leftJoinAndSelect('login.user', 'user')
      .leftJoinAndSelect('login.riskScore', 'risk');

    if (query.risk && VALID_RISK.includes(query.risk)) {
      qb.andWhere('risk.label = :risk', { risk: query.risk });
    }
    if (query.user) {
      qb.andWhere('user.username LIKE :user', { user: `%${query.user}%` });
    }
    if (query.dateFrom) {
      qb.andWhere('login.timestamp >= :dateFrom', { dateFrom: query.dateFrom });
    }
    if (query.dateTo) {
      qb.andWhere('login.timestamp <= :dateTo', { dateTo: query.dateTo });
    }
    if (query.datasetId) {
      qb.andWhere('login.datasetId = :datasetId', { datasetId: query.datasetId });
    }

    const sortBy = SORT_COLUMNS[query.sortBy] ?? SORT_COLUMNS.timestamp;
    qb.orderBy(sortBy, query.sortOrder === 'ASC' ? 'ASC' : 'DESC');

    const [rows, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: rows.map((login) => this.toListItem(login)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const login = await this.loginRepo
      .createQueryBuilder('login')
      .leftJoinAndSelect('login.user', 'user')
      .leftJoinAndSelect('login.riskScore', 'risk')
      .leftJoinAndSelect('login.ruleHits', 'hits')
      .leftJoinAndSelect('login.features', 'features')
      .where('login.id = :id', { id })
      .getOne();

    if (!login) {
      throw new NotFoundException(`Login ${id} not found`);
    }

    const features = login.features?.[0];
    const explainThreshold = this.configService.getRules().explainThreshold;
    const aiExplanation =
      login.riskScore && login.riskScore.totalScore >= explainThreshold
        ? await this.explanationsService.getForLogin(login.id)
        : null;

    return {
      ...this.toListItem(login),
      ruleHits: (login.ruleHits ?? []).map((h: RuleHit) => ({
        ruleName: h.ruleName,
        triggered: h.triggered,
        details: h.details ?? undefined,
        score: h.score,
      })),
      features: features
        ? {
            loginHour: features.loginHour,
            dayOfWeek: features.dayOfWeek,
            failedAttemptsInWindow: features.failedAttemptsInWindow,
            countryChange: features.countryChange,
            deviceChange: features.deviceChange,
            browserChange: features.browserChange,
            ipChange: features.ipChange,
            geoDistanceKm: features.geoDistanceKm,
            accountLoginFrequency: features.accountLoginFrequency,
            historicalSuccessRate: features.historicalSuccessRate,
          }
        : null,
      aiExplanation,
    };
  }

  async getStats(datasetId?: string) {
    const where = datasetId ? { datasetId } : undefined;

    const total = await this.loginRepo.count(where ? { where } : undefined);
    const byLabel = await this.riskScoreRepo
      .createQueryBuilder('risk')
      .innerJoin('risk.login', 'login')
      .select('risk.label', 'label')
      .addSelect('COUNT(*)', 'count')
      .where(datasetId ? 'login.datasetId = :datasetId' : '1 = 1', datasetId ? { datasetId } : {})
      .groupBy('risk.label')
      .getRawMany<{ label: string; count: string }>();

    const counts: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    for (const row of byLabel) if (row.label in counts) counts[row.label] = Number(row.count);
    const critical = counts.Critical;
    const high = counts.High;
    const medium = counts.Medium;
    const low = counts.Low;
    const flagged = critical + high + medium; // Medium+ == total_score >= 40

    const top = await this.riskScoreRepo
      .createQueryBuilder('risk')
      .innerJoinAndSelect('risk.login', 'login')
      .leftJoinAndSelect('login.user', 'user')
      .where(datasetId ? 'login.datasetId = :datasetId' : '1 = 1', datasetId ? { datasetId } : {})
      .orderBy('risk.totalScore', 'DESC')
      .take(1)
      .getOne();

    return {
      total,
      flagged,
      flaggedPercent: total > 0 ? Math.round((flagged / total) * 100) : 0,
      critical,
      high,
      medium,
      low,
      topRiskyUser: top?.login?.user?.username ?? null,
      topScore: top?.totalScore ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Dashboard aggregations (scoped by datasetId when provided)
  // -------------------------------------------------------------------------

  async getTrend(datasetId?: string, bucket = 'hour', range = 24) {
    const isPg = this.dataSource.options.type === 'postgres';
    const trunc = isPg
      ? `DATE_TRUNC('${bucket}', login.timestamp)`
      : bucket === 'hour'
        ? `strftime('%Y-%m-%d %H:00:00', login.timestamp)`
        : `date(login.timestamp)`;

    const qb = this.loginRepo
      .createQueryBuilder('login')
      .innerJoinAndSelect('login.riskScore', 'risk')
      .select(trunc, 'bucket')
      .addSelect('COUNT(*)', 'total')
      .addSelect("SUM(CASE WHEN login.success = 1 THEN 0 ELSE 1 END)", 'failed')
      .addSelect("SUM(CASE WHEN risk.total_score >= 40 THEN 1 ELSE 0 END)", 'flagged')
      .groupBy('bucket')
      .orderBy('bucket', 'ASC');
    if (datasetId) qb.where('login.datasetId = :datasetId', { datasetId });

    const rows = (await qb.getRawMany()) as {
      bucket: string | Date;
      total: string | number;
      failed: string | number;
      flagged: string | number;
    }[];

    const mapped: {
      t: string;
      total: number;
      failed: number;
      flagged: number;
      baseline: number;
      spike: boolean;
    }[] = rows
      .map((r) => ({
        t: isPg ? (r.bucket as Date).toISOString() : String(r.bucket),
        total: Number(r.total),
        failed: Number(r.failed),
        flagged: Number(r.flagged),
        baseline: 0,
        spike: false,
      }))
      .slice(-range);

    const baseline = this.computeBaseline(mapped, 4);
    for (let i = 0; i < mapped.length; i++) {
      mapped[i].baseline = baseline[i];
      mapped[i].spike = mapped[i].total > baseline[i] * 2.0 && baseline[i] > 0;
    }
    return { bucket, range, points: mapped };
  }

  async getHeatmap(datasetId?: string) {
    const qb = this.featureRepo
      .createQueryBuilder('f')
      .innerJoin('f.login', 'login')
      .select('f.dayOfWeek', 'day')
      .addSelect('f.loginHour', 'hour')
      .addSelect('COUNT(*)', 'count');
    if (datasetId) qb.where('login.datasetId = :datasetId', { datasetId });
    qb.groupBy('f.dayOfWeek').addGroupBy('f.loginHour');

    const rows = (await qb.getRawMany()) as {
      day: number | string;
      hour: number | string;
      count: string;
    }[];
    return rows.map((r) => ({
      day: Number(r.day),
      hour: Number(r.hour),
      count: Number(r.count),
    }));
  }

  async getTop(datasetId?: string, limit = 10) {
    const scope = (q: any) => (datasetId ? q.where('login.datasetId = :datasetId', { datasetId }) : q);

    const userQb = scope(
      this.loginRepo
        .createQueryBuilder('login')
        .innerJoin('login.user', 'user')
        .select('user.username', 'username')
        .addSelect('COUNT(*)', 'logins')
        .addSelect("SUM(CASE WHEN login.success = 0 THEN 1 ELSE 0 END)", 'failed')
        .groupBy('user.username')
        .orderBy('logins', 'DESC')
        .take(limit),
    );
    const users = (await userQb.getRawMany()) as {
      username: string;
      logins: string;
      failed: string;
    }[];

    const ruleQb = this.riskScoreRepo
      .createQueryBuilder('risk')
      .innerJoin('risk.login', 'login')
      .innerJoin('login.ruleHits', 'rule')
      .select('rule.ruleName AS ruleName')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(rule.score) AS maxScore');
    if (datasetId) ruleQb.where('login.datasetId = :datasetId', { datasetId });
    ruleQb.groupBy('rule.ruleName').orderBy('count', 'DESC').take(limit);

    const rules = (await ruleQb.getRawMany()) as {
      ruleName: string;
      count: string;
      maxScore: string;
    }[];

    return {
      users: users.map((u) => ({
        username: u.username,
        logins: Number(u.logins),
        failed: Number(u.failed),
      })),
      rules: rules.map((r) => ({
        ruleName: r.ruleName,
        count: Number(r.count),
        maxScore: Number(r.maxScore),
      })),
    };
  }

  async getBox(datasetId?: string, bucket = 'year') {
    const is = this.dbType === 'postgres';
    const trunc = is
      ? `DATE_TRUNC('${bucket}', login.timestamp)`
      : bucket === 'hour'
        ? `strftime('%Y-%m-%d %H:00:00', login.timestamp)`
        : bucket === 'day'
          ? `strftime('%Y-%m-%d', login.timestamp)`
          : `strftime('%Y-%m', login.timestamp)`;

    const qb = this.loginRepo
      .createQueryBuilder('login')
      .innerJoinAndSelect('login.riskScore', 'risk')
      .select(trunc, 'bucket')
      .addSelect('risk.total_score', 'score')
      .orderBy('bucket', 'ASC');
    if (datasetId) qb.where('login.datasetId = :datasetId', { datasetId });

    const rows = (await qb.getRawMany()) as {
      bucket: string | Date;
      score: number | string;
    }[];
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const key = String(r.bucket);
      const list = groups.get(key) ?? [];
      list.push(Number(r.score));
      groups.set(key, list);
    }

    const results: { key: string; min: number; q1: number; median: number; q3: number; max: number; mean: number; count: number }[] = [];
    for (const [key, scores] of groups) {
      results.push({ key, ...this.percentiles(scores) });
    }
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }

async getScatter(datasetId?: string, limit = 500) {
    const n = Math.min(Math.max(limit, 1), 1000);
    const idsQb = this.loginRepo
      .createQueryBuilder('login')
      .select('login.id', 'id')
      .orderBy('login.timestamp', 'DESC')
      .take(n);
    if (datasetId) idsQb.where('login.datasetId = :datasetId', { datasetId });
    const ids = (await idsQb.getRawMany()) as { id: string }[];

    if (ids.length === 0) return [];

    const qb = this.loginRepo
      .createQueryBuilder('login')
      .innerJoin('login.riskScore', 'risk')
      .leftJoin('login.features', 'features')
      .leftJoin('login.user', 'user')
      .select('login.id', 'id')
      .addSelect('login.success', 'success')
      .addSelect('risk.total_score', 'score')
      .addSelect('features.geo_distance_km', 'geoKm')
      .addSelect('features.failed_attempts_in_window', 'tries')
      .addSelect('user.username', 'username')
      .where('login.id IN (:...ids)', { ids: ids.map((r) => r.id) });

    const rows = (await qb.getRawMany()) as {
      id: string;
      success: number | string;
      score: number | string;
      geoKm: number | string;
      tries: number | string;
      username: string | null;
    }[];
    return rows.map((l) => ({
      username: l.username ?? l.id,
      success: Number(l.success) === 1,
      score: Number(l.score),
      geoKm: Number(l.geoKm),
      tries: Number(l.tries),
    }));
  }

  private get dbType() {
    return this.dataSource.options.type;
  }

  private computeBaseline(points: { total: number }[], window: number): number[] {
    const out: number[] = [];
    let sum = 0;
    const q: number[] = [];
    for (const p of points) {
      q.push(p.total);
      sum += p.total;
      if (q.length > window) sum -= q.shift()!;
      out.push(q.length === 0 ? 0 : sum / q.length);
    }
    return out;
  }

  private percentiles(scores: number[]) {
    const sorted = [...scores].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const p = (k: number) => {
      if (sorted.length === 0) return 0;
      const pos = (sorted.length - 1) * k;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
      }
      return sorted[base];
    };
    return {
      min: sorted[0] ?? 0,
      q1: p(0.25),
      median: p(0.5),
      q3: p(0.75),
      max: sorted[sorted.length - 1] ?? 0,
      mean: sorted.length ? Math.round((sum / sorted.length) * 100) / 100 : 0,
      count: sorted.length,
    };
  }

  private toListItem(login: Login) {
    const risk = login.riskScore;
    return {
      id: login.id,
      userId: login.userId,
      username: login.user?.username ?? '',
      timestamp: login.timestamp,
      ip: login.ip,
      country: login.country,
      city: login.city,
      device: login.device,
      browser: login.browser,
      success: login.success,
      riskScore: risk
        ? {
            finalScore: risk.totalScore,
            label: risk.label,
            ruleScore: risk.ruleScore,
            mlScore: risk.mlScore,
            threatIntelScore: 0,
          }
        : null,
      ruleHits: [],
    };
  }
}
