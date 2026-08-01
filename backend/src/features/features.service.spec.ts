import { FeaturesService, LoginEvent } from './features.service';
import { countryDistanceKm } from './geo';

describe('FeaturesService', () => {
  const service = new FeaturesService();

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

  it('computes login_hour and day_of_week (Mon=0)', () => {
    // 2026-01-05 is a Monday
    const login = event(new Date(2026, 0, 5, 14, 30, 0));
    const f = service.compute(login, []);
    expect(f.login_hour).toBe(14);
    expect(f.day_of_week).toBe(0);
  });

  it('counts failed attempts only inside the window', () => {
    const t = new Date(2026, 0, 5, 10, 0, 0);
    const history = [
      event(new Date(t.getTime() - 2 * 60_000), { success: false }),
      event(new Date(t.getTime() - 5 * 60_000), { success: false }),
      event(new Date(t.getTime() - 12 * 60_000), { success: false }),
      event(new Date(t.getTime() - 3 * 60_000), { success: true }),
    ];
    const f = service.compute(event(t), history);
    expect(f.failed_attempts_in_window).toBe(2);
  });

  it('respects a custom failed window', () => {
    const t = new Date(2026, 0, 5, 10, 0, 0);
    const history = [
      event(new Date(t.getTime() - 8 * 60_000), { success: false }),
      event(new Date(t.getTime() - 2 * 60_000), { success: false }),
    ];
    const f = service.compute(event(t), history, { failedWindowMinutes: 5 });
    expect(f.failed_attempts_in_window).toBe(1);
  });

  it('flags country/device/browser/ip changes vs previous login', () => {
    const t = new Date(2026, 0, 5, 10, 0, 0);
    const prev = event(new Date(t.getTime() - 60 * 60_000));
    const f = service.compute(
      event(t, {
        ip: '1.1.1.1',
        country: 'NG',
        device: 'Windows',
        browser: 'Chrome',
      }),
      [prev],
    );
    expect(f.country_change).toBe(1);
    expect(f.device_change).toBe(1);
    expect(f.browser_change).toBe(1);
    expect(f.ip_change).toBe(1);
  });

  it('reports no changes when attributes match the previous login', () => {
    const t = new Date(2026, 0, 5, 10, 0, 0);
    const prev = event(new Date(t.getTime() - 60 * 60_000));
    const f = service.compute(event(t), [prev]);
    expect(f.country_change).toBe(0);
    expect(f.device_change).toBe(0);
    expect(f.browser_change).toBe(0);
    expect(f.ip_change).toBe(0);
  });

  it('computes geo distance between country centroids', () => {
    const t = new Date(2026, 0, 5, 10, 0, 0);
    const prev = event(new Date(t.getTime() - 60 * 60_000), { country: 'US' });
    const f = service.compute(event(t, { country: 'NG' }), [prev]);
    expect(f.geo_distance_km).toBeCloseTo(countryDistanceKm('US', 'NG'), 5);
    expect(f.geo_distance_km).toBeGreaterThan(5000);
  });

  it('returns zero distance and changes without history', () => {
    const f = service.compute(event(new Date(2026, 0, 5, 10, 0, 0)), []);
    expect(f.geo_distance_km).toBe(0);
    expect(f.country_change).toBe(0);
    expect(f.ip_change).toBe(0);
  });

  it('computes account login frequency as logins per day over history span', () => {
    const t = new Date(2026, 0, 5, 0, 0, 0);
    // 10 events spread over exactly 2 days before t: oldest at t-2d, newest at t-0.2d
    const history = Array.from({ length: 10 }, (_, i) =>
      event(new Date(t.getTime() - (i + 1) * 0.2 * 86_400_000)),
    ).reverse();
    const f = service.compute(event(t), history);
    expect(f.account_login_frequency).toBeCloseTo(5, 5);
  });

  it('computes historical success rate', () => {
    const t = new Date(2026, 0, 5, 10, 0, 0);
    const history = [
      ...Array.from({ length: 7 }, (_, i) =>
        event(new Date(t.getTime() - (i + 1) * 3_600_000), { success: true }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        event(new Date(t.getTime() - (i + 8) * 3_600_000), { success: false }),
      ),
    ];
    const f = service.compute(event(t), history);
    expect(f.historical_success_rate).toBeCloseTo(0.7, 5);
  });

  it('returns zero frequency and success rate without history', () => {
    const f = service.compute(event(new Date(2026, 0, 5, 10, 0, 0)), []);
    expect(f.account_login_frequency).toBe(0);
    expect(f.historical_success_rate).toBe(0);
  });
});
