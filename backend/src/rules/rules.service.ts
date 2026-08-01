import { Injectable } from '@nestjs/common';
import { RuleConfig } from '../config/config.service';
import { LoginEvent, LoginFeatures } from '../features/features.service';
import { isBlacklistedIp } from './blacklist';

/** Individual rule result (contract from prompt.md §5). */
export interface RuleHit {
  ruleName: string;
  triggered: boolean;
  details?: string;
  score: number;
}

export interface RuleEvaluation {
  hits: RuleHit[];
  score: number; // sum of triggered rule scores, capped at 100
}

const MAX_RULE_SCORE = 100;

export type RiskLabel = 'Low' | 'Medium' | 'High' | 'Critical';

export function riskLabel(score: number): RiskLabel {
  if (score >= 85) {
    return 'Critical';
  }
  if (score >= 65) {
    return 'High';
  }
  if (score >= 40) {
    return 'Medium';
  }
  return 'Low';
}

/**
 * Pure rule engine — no DB access, thresholds come from RuleConfig.
 * `history` must be the user's prior logins sorted ascending by timestamp.
 */
@Injectable()
export class RulesService {
  evaluate(
    login: LoginEvent,
    features: LoginFeatures,
    history: LoginEvent[],
    config: RuleConfig,
  ): RuleEvaluation {
    const hits = [
      this.failedLoginBurst(features, config),
      this.impossibleTravel(login, features, history, config),
      this.blacklistedIp(login, config),
      this.newDevice(features, config),
      this.oddHour(features, config),
    ];
    const score = Math.min(
      MAX_RULE_SCORE,
      hits.reduce((sum, h) => sum + (h.triggered ? h.score : 0), 0),
    );
    return { hits, score };
  }

  private failedLoginBurst(features: LoginFeatures, config: RuleConfig): RuleHit {
    const triggered =
      features.failed_attempts_in_window >= config.failedLoginBurstThreshold;
    return {
      ruleName: 'failed_login_burst',
      triggered,
      details: triggered
        ? `${features.failed_attempts_in_window} failed attempts in the last ${config.failedLoginBurstWindowMinutes} minutes`
        : undefined,
      score: config.failedLoginBurstScore,
    };
  }

  private impossibleTravel(
    login: LoginEvent,
    features: LoginFeatures,
    history: LoginEvent[],
    config: RuleConfig,
  ): RuleHit {
    const prev = history[history.length - 1];
    let triggered = false;
    let details: string | undefined;
    if (prev && features.geo_distance_km > 0) {
      const hours =
        (login.timestamp.getTime() - prev.timestamp.getTime()) / 3_600_000;
      const maxDistance = hours * config.impossibleTravelSpeedKmh;
      triggered = features.geo_distance_km > maxDistance;
      if (triggered) {
        details = `${features.geo_distance_km.toFixed(0)} km in ${hours.toFixed(1)}h (max ${maxDistance.toFixed(0)} km at ${config.impossibleTravelSpeedKmh} km/h)`;
      }
    }
    return {
      ruleName: 'impossible_travel',
      triggered,
      details,
      score: config.impossibleTravelScore,
    };
  }

  private blacklistedIp(
    login: LoginEvent,
    config: RuleConfig,
  ): RuleHit {
    const triggered = isBlacklistedIp(login.ip);
    return {
      ruleName: 'blacklisted_ip',
      triggered,
      details: triggered ? `IP ${login.ip} matches a known-malicious range` : undefined,
      score: config.blacklistedIpScore,
    };
  }

  private newDevice(features: LoginFeatures, config: RuleConfig): RuleHit {
    const triggered = features.device_change === 1;
    return {
      ruleName: 'new_device',
      triggered,
      details: triggered ? 'Device not seen before for this user' : undefined,
      score: config.newDeviceScore,
    };
  }

  private oddHour(features: LoginFeatures, config: RuleConfig): RuleHit {
    const triggered =
      features.login_hour >= config.oddHourStart ||
      features.login_hour < config.oddHourEnd;
    return {
      ruleName: 'odd_hour',
      triggered,
      details: triggered
        ? `Login at hour ${features.login_hour} (unusual hours ${config.oddHourStart}:00–${config.oddHourEnd}:00)`
        : undefined,
      score: config.oddHourScore,
    };
  }
}
