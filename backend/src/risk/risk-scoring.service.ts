import { Injectable } from '@nestjs/common';
import { RuleConfig } from '../config/config.service';
import { riskLabel, RiskLabel } from '../rules/rules.service';

export interface RiskScoreResult {
  totalScore: number;
  label: RiskLabel;
}

/**
 * Combines rule and ML scores into a single 0-100 risk score with a label.
 * Weights come from RuleConfig (configurable via /api/config/rules, FR5.2).
 * When mlScore is absent (model not trained yet), falls back to ruleScore.
 */
@Injectable()
export class RiskScoringService {
  combine(
    ruleScore: number,
    mlScore: number | null,
    config: RuleConfig,
  ): RiskScoreResult {
    const totalScore =
      mlScore === null
        ? ruleScore
        : Math.min(
            100,
            Math.max(
              0,
              Math.round(
                ruleScore * config.ruleScoreWeight +
                  mlScore * config.mlScoreWeight,
              ),
            ),
          );
    return { totalScore, label: riskLabel(totalScore) };
  }
}
