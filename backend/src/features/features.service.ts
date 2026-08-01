import { Injectable } from '@nestjs/common';
import { countryDistanceKm } from './geo';

/** A single login event as consumed by feature engineering / rules. */
export interface LoginEvent {
  username: string;
  timestamp: Date;
  ip: string;
  country: string;
  city: string;
  device: string;
  browser: string;
  success: boolean;
}

/** Feature vector computed per login (contract from prompt.md §5). */
export interface LoginFeatures {
  login_hour: number; // 0-23
  day_of_week: number; // 0-6 (Mon=0)
  failed_attempts_in_window: number;
  country_change: number; // 0 | 1
  device_change: number; // 0 | 1
  browser_change: number; // 0 | 1
  ip_change: number; // 0 | 1
  geo_distance_km: number;
  account_login_frequency: number; // avg logins/day (history)
  historical_success_rate: number; // 0-1
}

export interface FeatureOptions {
  failedWindowMinutes?: number;
}

const DEFAULT_FAILED_WINDOW_MINUTES = 10;

/**
 * Pure feature engineering — no DB access, unit-testable.
 * `history` must be the user's prior logins sorted ascending by timestamp.
 */
@Injectable()
export class FeaturesService {
  compute(
    login: LoginEvent,
    history: LoginEvent[],
    options: FeatureOptions = {},
  ): LoginFeatures {
    const windowMs =
      (options.failedWindowMinutes ?? DEFAULT_FAILED_WINDOW_MINUTES) * 60_000;
    const prev = history[history.length - 1];

    const failedInWindow = history.filter(
      (h) => !h.success && login.timestamp.getTime() - h.timestamp.getTime() <= windowMs,
    ).length;

    const historyCount = history.length;
    const historyStart = history[0]?.timestamp.getTime();
    const spanDays =
      historyStart !== undefined
        ? Math.max(1, (login.timestamp.getTime() - historyStart) / 86_400_000)
        : 0;
    const successes = history.filter((h) => h.success).length;

    return {
      login_hour: login.timestamp.getHours(),
      day_of_week: (login.timestamp.getDay() + 6) % 7, // Mon=0
      failed_attempts_in_window: failedInWindow,
      country_change: prev && prev.country !== login.country ? 1 : 0,
      device_change: prev && prev.device !== login.device ? 1 : 0,
      browser_change: prev && prev.browser !== login.browser ? 1 : 0,
      ip_change: prev && prev.ip !== login.ip ? 1 : 0,
      geo_distance_km: prev ? countryDistanceKm(prev.country, login.country) : 0,
      account_login_frequency: spanDays > 0 ? historyCount / spanDays : 0,
      historical_success_rate: historyCount > 0 ? successes / historyCount : 0,
    };
  }
}
