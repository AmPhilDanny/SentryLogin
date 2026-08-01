import { Injectable } from '@nestjs/common';

export interface RuleConfig {
  failedLoginBurstThreshold: number;
  failedLoginBurstWindowMinutes: number;
  impossibleTravelSpeedKmh: number;
  oddHourStart: number;
  oddHourEnd: number;
  newDeviceScore: number;
  blacklistedIpScore: number;
  failedLoginBurstScore: number;
  impossibleTravelScore: number;
  oddHourScore: number;
  ruleScoreWeight: number;
  mlScoreWeight: number;
  explainThreshold: number;
}

const DEFAULT_RULES: RuleConfig = {
  failedLoginBurstThreshold: 5,
  failedLoginBurstWindowMinutes: 10,
  impossibleTravelSpeedKmh: 800,
  oddHourStart: 23,
  oddHourEnd: 6,
  newDeviceScore: 20,
  blacklistedIpScore: 45,
  failedLoginBurstScore: 40,
  impossibleTravelScore: 40,
  oddHourScore: 10,
  ruleScoreWeight: 0.6,
  mlScoreWeight: 0.4,
  explainThreshold: 65,
};

@Injectable()
export class ConfigService {
  private rules: RuleConfig = { ...DEFAULT_RULES };

  getRules(): RuleConfig {
    return this.rules;
  }

  updateRules(partial: Partial<RuleConfig>): RuleConfig {
    this.rules = { ...this.rules, ...partial };
    return this.rules;
  }
}
