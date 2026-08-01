import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert, AlertStatus } from './alert.entity';
import { RiskScore } from '../logins/risk-score.entity';

export interface AlertQuery {
  status?: AlertStatus;
  page: number;
  limit: number;
}

export interface AlertItem {
  loginId: string;
  userId: string;
  username: string;
  timestamp: string;
  ip: string;
  country: string;
  city: string;
  device: string;
  browser: string;
  success: boolean;
  finalScore: number;
  label: string;
  status: AlertStatus;
}

const MAX_LIMIT = 200;

/**
 * Alerts = High/Critical risk logins with a triage workflow (S4.3).
 * Status is stored per login in the alerts table; logins without an alert
 * row default to 'open'.
 */
@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(Alert) private readonly alertRepo: Repository<Alert>,
    @InjectRepository(RiskScore)
    private readonly riskScoreRepo: Repository<RiskScore>,
  ) {}

  async findAll(query: AlertQuery) {
    const page = Math.max(1, Math.floor(query.page) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit) || 50));

    const qb = this.riskScoreRepo
      .createQueryBuilder('risk')
      .innerJoinAndSelect('risk.login', 'login')
      .leftJoinAndSelect('login.user', 'user')
      .leftJoin(Alert, 'alert', 'alert.login_id = risk.login_id')
      .addSelect('alert.status', 'alert_status')
      .where("risk.label IN ('High', 'Critical')");

    if (query.status) {
      qb.andWhere(
        "COALESCE(alert.status, 'open') = :status",
        { status: query.status },
      );
    }

    qb.orderBy('risk.totalScore', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      data: rows.map((risk) => {
        const login = risk.login;
        return {
          loginId: login.id,
          userId: login.userId,
          username: login.user?.username ?? '',
          timestamp: login.timestamp.toISOString(),
          ip: login.ip,
          country: login.country,
          city: login.city,
          device: login.device,
          browser: login.browser,
          success: login.success,
          finalScore: risk.totalScore,
          label: risk.label,
          status: this.statusOf(risk),
        } as AlertItem;
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateStatus(
    loginId: string,
    status: AlertStatus,
  ): Promise<AlertItem> {
    const risk = await this.riskScoreRepo
      .createQueryBuilder('risk')
      .innerJoinAndSelect('risk.login', 'login')
      .leftJoinAndSelect('login.user', 'user')
      .where('risk.login_id = :loginId', { loginId })
      .getOne();

    if (!risk || !['High', 'Critical'].includes(risk.label)) {
      throw new NotFoundException(`Alert for login ${loginId} not found`);
    }

    let alert = await this.alertRepo.findOne({ where: { loginId } });
    if (!alert) {
      alert = this.alertRepo.create({ loginId, status });
    } else {
      alert.status = status;
    }
    await this.alertRepo.save(alert);

    const login = risk.login;
    return {
      loginId: login.id,
      userId: login.userId,
      username: login.user?.username ?? '',
      timestamp: login.timestamp.toISOString(),
      ip: login.ip,
      country: login.country,
      city: login.city,
      device: login.device,
      browser: login.browser,
      success: login.success,
      finalScore: risk.totalScore,
      label: risk.label,
      status: alert.status,
    };
  }

  private statusOf(risk: RiskScore & { alert_status?: string }): AlertStatus {
    return (risk.alert_status as AlertStatus) ?? 'open';
  }
}
