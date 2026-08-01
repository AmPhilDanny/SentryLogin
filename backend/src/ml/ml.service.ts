import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserFeature } from '../logins/user-feature.entity';
import { RiskScore } from '../logins/risk-score.entity';
import { RiskScoringService } from '../risk/risk-scoring.service';
import { ConfigService } from '../config/config.service';

/** Feature vector payload — mirrors ML service FeatureVector (models.py). */
interface FeatureVector {
  login_hour: number;
  day_of_week: number;
  failed_attempts_in_window: number;
  country_change: number;
  device_change: number;
  browser_change: number;
  ip_change: number;
  geo_distance_km: number;
  account_login_frequency: number;
  historical_success_rate: number;
}

interface TrainResponse {
  status: string;
  samples_trained: number;
  feature_count: number;
  model_id: string;
}

interface ScoreResponse {
  scores: number[];
  predictions: number[];
}

interface HealthResponse {
  status: string;
  service: string;
  trained: boolean;
  model_id: string;
}

export interface MlStatus {
  available: boolean;
  trained: boolean;
  model_id: string;
}

export interface TrainSummary {
  status: string;
  samples_trained: number;
  feature_count: number;
  model_id: string;
  scored_logins: number;
}

const HTTP_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 3_000;
const UPDATE_CHUNK = 200;

@Injectable()
export class MlService {
  constructor(
    @InjectRepository(UserFeature)
    private readonly featureRepo: Repository<UserFeature>,
    @InjectRepository(RiskScore)
    private readonly riskScoreRepo: Repository<RiskScore>,
    private readonly riskScoring: RiskScoringService,
    private readonly configService: ConfigService,
  ) {}

  private baseUrl(): string {
    return process.env.ML_SERVICE_URL || 'http://localhost:8000';
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch {
      throw new HttpException(
        `ML service unreachable at ${this.baseUrl()}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new HttpException(
        `ML service error (${res.status}): ${detail.slice(0, 300)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    return (await res.json()) as T;
  }

  private async get<T>(path: string, timeoutMs: number): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl()}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return null;
      }
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  /** Convert a UserFeature entity to the ML service feature vector. */
  private toVector(f: UserFeature): FeatureVector {
    return {
      login_hour: f.loginHour,
      day_of_week: f.dayOfWeek,
      failed_attempts_in_window: f.failedAttemptsInWindow,
      country_change: f.countryChange ? 1 : 0,
      device_change: f.deviceChange ? 1 : 0,
      browser_change: f.browserChange ? 1 : 0,
      ip_change: f.ipChange ? 1 : 0,
      geo_distance_km: f.geoDistanceKm,
      account_login_frequency: f.accountLoginFrequency,
      historical_success_rate: f.historicalSuccessRate,
    };
  }

  /** Map raw sklearn score_samples (lower = more anomalous) to 0-100 risk. */
  private normalizeToRisk(scores: number[]): number[] {
    if (scores.length === 0) {
      return [];
    }
    let min = Infinity;
    let max = -Infinity;
    for (const s of scores) {
      if (s < min) min = s;
      if (s > max) max = s;
    }
    if (max === min) {
      return scores.map(() => 0);
    }
    return scores.map((s) => Math.round(((max - s) / (max - min)) * 100));
  }

  async status(): Promise<MlStatus> {
    const health = await this.get<HealthResponse>('/health', HEALTH_TIMEOUT_MS);
    if (health === null) {
      return { available: false, trained: false, model_id: '' };
    }
    return {
      available: true,
      trained: health.trained,
      model_id: health.model_id,
    };
  }

  /** Train the ML model on all stored feature vectors, then backfill risk scores. */
  async trainOnDatabase(): Promise<TrainSummary> {
    const features = await this.featureRepo.find();
    if (features.length < 10) {
      throw new HttpException(
        'Need at least 10 stored feature vectors to train',
        HttpStatus.BAD_REQUEST,
      );
    }

    const vectors = features.map((f) => this.toVector(f));
    const trained = await this.post<TrainResponse>('/train', {
      features: vectors,
    });
    const scored = await this.post<ScoreResponse>('/score', {
      features: vectors,
    });
    const mlScores = this.normalizeToRisk(scored.scores);

    const byLogin = new Map<string, number>();
    for (let i = 0; i < features.length; i++) {
      byLogin.set(features[i].loginId, mlScores[i]);
    }

    const config = this.configService.getRules();
    const riskScores = await this.riskScoreRepo.find();
    const updates: {
      loginId: string;
      mlScore: number;
      totalScore: number;
      label: string;
    }[] = [];
    for (const rs of riskScores) {
      const ml = byLogin.get(rs.loginId);
      if (ml === undefined) {
        continue;
      }
      const combined = this.riskScoring.combine(rs.ruleScore, ml, config);
      updates.push({
        loginId: rs.loginId,
        mlScore: ml,
        totalScore: combined.totalScore,
        label: combined.label,
      });
    }

    await this.bulkUpdateRiskScores(updates);

    return {
      status: 'success',
      samples_trained: trained.samples_trained,
      feature_count: trained.feature_count,
      model_id: trained.model_id,
      scored_logins: updates.length,
    };
  }

  /** Chunked bulk update of ml_score/total_score/label (single transaction). */
  private async bulkUpdateRiskScores(
    updates: {
      loginId: string;
      mlScore: number;
      totalScore: number;
      label: string;
    }[],
  ): Promise<void> {
    const qr = this.riskScoreRepo.manager.connection.createQueryRunner();
    try {
      await qr.connect();
      await qr.query('PRAGMA journal_mode = WAL');
      await qr.query('PRAGMA synchronous = NORMAL');
      await qr.startTransaction();
      for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
        const chunk = updates.slice(i, i + UPDATE_CHUNK);
        const mlWhen: string[] = [];
        const totalWhen: string[] = [];
        const labelWhen: string[] = [];
        const params: (string | number)[] = [];
        for (const u of chunk) {
          mlWhen.push('WHEN ? THEN ?');
          params.push(u.loginId, u.mlScore);
        }
        for (const u of chunk) {
          totalWhen.push('WHEN ? THEN ?');
          params.push(u.loginId, u.totalScore);
        }
        for (const u of chunk) {
          labelWhen.push('WHEN ? THEN ?');
          params.push(u.loginId, u.label);
        }
        const ids = chunk.map((u) => u.loginId);
        const sql = `UPDATE risk_scores SET
          ml_score = CASE login_id ${mlWhen.join(' ')} ELSE ml_score END,
          total_score = CASE login_id ${totalWhen.join(' ')} ELSE total_score END,
          label = CASE login_id ${labelWhen.join(' ')} ELSE label END
          WHERE login_id IN (${ids.map(() => '?').join(',')})`;
        await qr.query(sql, [...params, ...ids]);
      }
      await qr.commitTransaction();
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }
  }
}
