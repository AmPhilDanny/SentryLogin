import { RulesService, riskLabel, RuleEvaluation } from './rules.service';
import { LoginEvent, LoginFeatures } from '../features/features.service';
import { RuleConfig } from '../config/config.service';

const CONFIG: RuleConfig = {
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

describe('RulesService', () => {
  const service = new RulesService();

  function event(
    timestamp: Date,
    overrides: Partial<LoginEvent> = {},
  ): LoginEvent {
    return {
      username: 'alice',
      timestamp,
      ip: '8.8.8.8',
      country: 'US',
      city: 'Chicago',
      device: 'iPhone',
      browser: 'Safari',
      success: true,
      ...overrides,
    };
  }

  function features(overrides: Partial<LoginFeatures> = {}): LoginFeatures {
    return {
      login_hour: 12,
      day_of_week: 0,
      failed_attempts_in_window: 0,
      country_change: 0,
      device_change: 0,
      browser_change: 0,
      ip_change: 0,
      geo_distance_km: 0,
      account_login_frequency: 0,
      historical_success_rate: 0,
      ...overrides,
    };
  }

  function hitByName(e: RuleEvaluation, name: string) {
    return e.hits.find((h) => h.ruleName === name)!;
  }

  it('triggers failed_login_burst at and above threshold', () => {
    const below = service.evaluate(event(new Date()), features({ failed_attempts_in_window: 4 }), [], CONFIG);
    expect(hitByName(below, 'failed_login_burst').triggered).toBe(false);

    const at = service.evaluate(event(new Date()), features({ failed_attempts_in_window: 5 }), [], CONFIG);
    const hit = hitByName(at, 'failed_login_burst');
    expect(hit.triggered).toBe(true);
    expect(hit.score).toBe(40);
    expect(hit.details).toContain('5 failed attempts');
  });

  it('triggers impossible_travel only when distance exceeds speed * elapsed hours', () => {
    const t = new Date('2026-01-05T10:00:00Z');
    // US -> NG is ~10,000 km; 1 hour apart exceeds 800 km/h
    const fast = service.evaluate(
      event(t, { country: 'NG' }),
      features({ geo_distance_km: 10_000 }),
      [event(new Date('2026-01-05T09:00:00Z'))],
      CONFIG,
    );
    expect(hitByName(fast, 'impossible_travel').triggered).toBe(true);

    // 20 hours apart allows 16,000 km — not triggered
    const slow = service.evaluate(
      event(t, { country: 'NG' }),
      features({ geo_distance_km: 10_000 }),
      [event(new Date('2026-01-04T14:00:00Z'))],
      CONFIG,
    );
    expect(hitByName(slow, 'impossible_travel').triggered).toBe(false);
  });

  it('does not trigger impossible_travel without prior history', () => {
    const e = service.evaluate(
      event(new Date(), { country: 'NG' }),
      features({ geo_distance_km: 10_000 }),
      [],
      CONFIG,
    );
    expect(hitByName(e, 'impossible_travel').triggered).toBe(false);
  });

  it('triggers blacklisted_ip for known malicious ranges', () => {
    const hit = service.evaluate(
      event(new Date(), { ip: '185.220.101.71' }),
      features(),
      [],
      CONFIG,
    );
    expect(hitByName(hit, 'blacklisted_ip').triggered).toBe(true);

    const clean = service.evaluate(event(new Date()), features(), [], CONFIG);
    expect(hitByName(clean, 'blacklisted_ip').triggered).toBe(false);
  });

  it('triggers new_device on device change', () => {
    const on = service.evaluate(
      event(new Date()),
      features({ device_change: 1 }),
      [],
      CONFIG,
    );
    expect(hitByName(on, 'new_device').triggered).toBe(true);

    const off = service.evaluate(event(new Date()), features(), [], CONFIG);
    expect(hitByName(off, 'new_device').triggered).toBe(false);
  });

  it('triggers odd_hour outside configured hours', () => {
    const late = service.evaluate(event(new Date()), features({ login_hour: 23 }), [], CONFIG);
    expect(hitByName(late, 'odd_hour').triggered).toBe(true);

    const early = service.evaluate(event(new Date()), features({ login_hour: 3 }), [], CONFIG);
    expect(hitByName(early, 'odd_hour').triggered).toBe(true);

    const noon = service.evaluate(event(new Date()), features({ login_hour: 12 }), [], CONFIG);
    expect(hitByName(noon, 'odd_hour').triggered).toBe(false);
  });

  it('sums triggered scores and caps at 100', () => {
    const t = new Date('2026-01-05T10:00:00Z');
    const e = service.evaluate(
      event(t, { ip: '185.220.101.71', country: 'NG' }),
      features({
        failed_attempts_in_window: 5,
        device_change: 1,
        login_hour: 23,
        geo_distance_km: 10_000,
      }),
      [event(new Date('2026-01-05T09:00:00Z'))],
      CONFIG,
    );
    // 40 (burst) + 40 (travel) + 45 (blacklist) + 20 (device) + 10 (odd hour) = 155 -> capped 100
    expect(e.hits.every((h) => h.triggered)).toBe(true);
    expect(e.score).toBe(100);
  });

  it('returns zero score when nothing triggers', () => {
    const e = service.evaluate(event(new Date()), features(), [], CONFIG);
    expect(e.score).toBe(0);
    expect(e.hits).toHaveLength(5);
  });
});

describe('riskLabel', () => {
  it('maps score thresholds to labels', () => {
    expect(riskLabel(100)).toBe('Critical');
    expect(riskLabel(85)).toBe('Critical');
    expect(riskLabel(84)).toBe('High');
    expect(riskLabel(65)).toBe('High');
    expect(riskLabel(64)).toBe('Medium');
    expect(riskLabel(40)).toBe('Medium');
    expect(riskLabel(39)).toBe('Low');
    expect(riskLabel(0)).toBe('Low');
  });
});
