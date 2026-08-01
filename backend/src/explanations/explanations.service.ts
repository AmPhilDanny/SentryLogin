import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiExplanation } from './ai-explanation.entity';
import { Login } from '../logins/login.entity';
import { RiskScore } from '../logins/risk-score.entity';
import { UsersService } from '../users/users.service';
import { ConfigService } from '../config/config.service';
import { generateExplanation } from './explanation-engine';

export interface ExplanationDto {
  explanation: string;
  recommendedAction: string;
  generatedAt: string;
}

/**
 * Generates and caches AI explanations for high-risk logins (S4.2).
 * Explanations are only generated above the explainThreshold (configurable)
 * and persisted in ai_explanations so repeat reads are free.
 */
@Injectable()
export class ExplanationsService {
  constructor(
    @InjectRepository(AiExplanation)
    private readonly explanationRepo: Repository<AiExplanation>,
    @InjectRepository(Login) private readonly loginRepo: Repository<Login>,
    @InjectRepository(RiskScore)
    private readonly riskScoreRepo: Repository<RiskScore>,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async getForLogin(loginId: string): Promise<ExplanationDto | null> {
    const cached = await this.explanationRepo.findOne({
      where: { loginId },
    });
    if (cached) {
      return this.toDto(cached);
    }
    return this.generateForLogin(loginId);
  }

  /** Generates (and caches) an explanation if above the risk threshold. */
  async generateForLogin(loginId: string): Promise<ExplanationDto | null> {
    const login = await this.loginRepo
      .createQueryBuilder('login')
      .leftJoinAndSelect('login.user', 'user')
      .leftJoinAndSelect('login.riskScore', 'risk')
      .leftJoinAndSelect('login.ruleHits', 'hits')
      .leftJoinAndSelect('login.features', 'features')
      .where('login.id = :id', { id: loginId })
      .getOne();

    if (!login || !login.riskScore) return null;

    const threshold = this.configService.getRules().explainThreshold;
    if (login.riskScore.totalScore < threshold) return null;

    const profile = await this.usersService.getProfile(login.userId);
    const result = generateExplanation({
      username: login.user?.username ?? login.userId,
      timestamp: login.timestamp,
      ip: login.ip,
      country: login.country,
      city: login.city,
      device: login.device,
      browser: login.browser,
      success: login.success,
      ruleScore: login.riskScore.ruleScore,
      mlScore: login.riskScore.mlScore,
      totalScore: login.riskScore.totalScore,
      label: login.riskScore.label,
      ruleHits: login.ruleHits ?? [],
      features: login.features?.[0] ?? null,
      profile,
    });

    const saved = await this.explanationRepo.save(
      this.explanationRepo.create({
        loginId,
        explanationText: result.explanationText,
        recommendedAction: result.recommendedAction,
      }),
    );
    return this.toDto(saved);
  }

  /** Generates explanations for every High/Critical login lacking one. */
  async backfill(): Promise<{ total: number; generated: number }> {
    const threshold = this.configService.getRules().explainThreshold;
    const candidates = await this.riskScoreRepo
      .createQueryBuilder('risk')
      .where('risk.totalScore >= :threshold', { threshold })
      .getMany();

    const existing = await this.explanationRepo.find();
    const have = new Set(existing.map((e) => e.loginId));
    const missing = candidates.filter((c) => !have.has(c.loginId));

    let generated = 0;
    for (const risk of missing) {
      const dto = await this.generateForLogin(risk.loginId);
      if (dto) generated++;
    }
    return { total: candidates.length, generated };
  }

  private toDto(e: AiExplanation): ExplanationDto {
    return {
      explanation: e.explanationText,
      recommendedAction: e.recommendedAction,
      generatedAt: e.generatedAt.toISOString(),
    };
  }
}
