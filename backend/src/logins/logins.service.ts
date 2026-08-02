import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Login } from './login.entity';
import { RiskScore } from './risk-score.entity';
import { RuleHit } from './rule-hit.entity';
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
