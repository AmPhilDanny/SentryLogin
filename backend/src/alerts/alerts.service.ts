import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert, AlertStatus, AlertResolution } from './alert.entity';
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
  resolution: AlertResolution | null;
  resolvedBy: string | null;
  notes: string | null;
  resolvedAt: string | null;
}

const MAX_LIMIT = 200;

// Allowed one-step transitions per state. 'resolved' is terminal.
const TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  open: ['dismissed', 'escalated'],
  dismissed: ['open'],
  escalated: ['open', 'investigated', 'resolved'],
  investigated: ['open', 'resolved'],
  resolved: [],
};

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
      .addSelect('alert.resolution', 'alert_resolution')
      .addSelect('alert.notes', 'alert_notes')
      .addSelect('alert.resolved_by', 'alert_resolved_by')
      .addSelect('alert.resolved_at', 'alert_resolved_at')
      .where("risk.label IN ('High', 'Critical')");

    if (query.status) {
      qb.andWhere("COALESCE(alert.status, 'open') = :status", {
        status: query.status,
      });
    }

    qb.orderBy('risk.totalScore', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      data: rows.map((risk) => this.toItem(risk)),
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
    const risk = await this.freshRisk(loginId);
    const alert = await this.findOrCreate(loginId);

    const from = alert.status;
    const allowed = TRANSITIONS[from] ?? [];
    if (!allowed.includes(status)) {
      const msg =
        allowed.length === 0
          ? `state "${from}" is terminal and cannot be changed`
          : `invalid transition ${from} -> ${status}; allowed: ${allowed.join(', ')}`;
      throw new BadRequestException(msg);
    }

    alert.status = status;
    if (status !== 'resolved') {
      alert.resolution = null;
      alert.resolvedBy = null;
      alert.resolvedAt = null;
    }
    await this.alertRepo.save(alert);
    return this.toItem(risk, alert);
  }

  async resolve(
    loginId: string,
    resolution: AlertResolution,
    notes: string | null,
    resolvedBy: string,
  ): Promise<AlertItem> {
    const risk = await this.freshRisk(loginId);
    const alert = await this.findOrCreate(loginId);

    if (!['escalated', 'investigated'].includes(alert.status)) {
      throw new BadRequestException(
        `cannot resolve an alert in state "${alert.status}"; it must be escalated or investigated first`,
      );
    }

    alert.status = 'resolved';
    alert.resolution = resolution;
    alert.notes = notes && notes.trim() ? notes.trim() : null;
    alert.resolvedBy = resolvedBy;
    alert.resolvedAt = new Date();
    await this.alertRepo.save(alert);
    return this.toItem(risk, alert);
  }

  private async freshRisk(loginId: string): Promise<RiskScore> {
    const risk = await this.riskScoreRepo
      .createQueryBuilder('risk')
      .innerJoinAndSelect('risk.login', 'login')
      .leftJoinAndSelect('login.user', 'user')
      .where('risk.login_id = :loginId', { loginId })
      .getOne();
    if (!risk || !['High', 'Critical'].includes(risk.label)) {
      throw new NotFoundException(`Alert for login ${loginId} not found`);
    }
    return risk;
  }

  private async findOrCreate(loginId: string): Promise<Alert> {
    let alert = await this.alertRepo.findOne({ where: { loginId } });
    if (!alert) {
      alert = this.alertRepo.create({ loginId, status: 'open' });
    }
    return alert;
  }

  private toItem(
    risk: RiskScore & {
      alert_status?: string;
      alert_resolution?: string | null;
      alert_notes?: string | null;
      alert_resolved_by?: string | null;
      alert_resolved_at?: Date | string | null;
    },
    alert?: Alert,
  ): AlertItem {
    const login = risk.login;
    const status = alert
      ? alert.status
      : ((risk.alert_status as AlertStatus) ?? 'open');
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
      status,
      resolution: alert
        ? alert.resolution
        : ((risk.alert_resolution as AlertResolution | null) ?? null),
      resolvedBy: alert ? alert.resolvedBy : (risk.alert_resolved_by ?? null),
      notes: alert ? alert.notes : (risk.alert_notes ?? null),
      resolvedAt: alert
        ? (alert.resolvedAt?.toISOString() ?? null)
        : risk.alert_resolved_at
          ? new Date(risk.alert_resolved_at as string).toISOString()
          : null,
    };
  }
}