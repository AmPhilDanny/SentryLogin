import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { api, LoginDetail as LoginDetailData, UserProfile } from '../lib/api';

const RULE_LABELS: Record<string, string> = {
  failed_login_burst: 'Failed Login Burst',
  impossible_travel: 'Impossible Travel',
  blacklisted_ip: 'Blacklisted IP',
  new_device: 'New Device',
  odd_hour: 'Odd Hour',
};

const SCORE_COLORS: Record<string, string> = {
  Low: '#22c55e',
  Medium: '#eab308',
  High: '#f97316',
  Critical: '#ef4444',
};

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-gray-400">{label}</span>
        <span className="font-semibold text-white">{Math.round(value)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-lighter">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }}
        />
      </div>
    </div>
  );
}

function FeatureRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-gray-700/50 px-3 py-2">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}

function ComparisonRow({
  label,
  loginValue,
  profileValue,
}: {
  label: string;
  loginValue: string | null;
  profileValue: string | null;
}) {
  const loginNorm = loginValue?.toLowerCase() ?? '';
  const profileNorm = profileValue?.toLowerCase() ?? '';
  const match = loginNorm !== '' && loginNorm === profileNorm;
  return (
    <div className="flex items-center justify-between rounded-md border border-gray-700/50 px-3 py-2">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium text-white">{loginValue || '—'}</span>
        <span className="text-xs text-gray-500">vs {profileValue || '—'}</span>
        {match ? (
          <CheckCircle2 className="h-4 w-4 text-risk-low" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-risk-high" />
        )}
      </span>
    </div>
  );
}

export default function LoginDetail() {
  const { id } = useParams();
  const [login, setLogin] = useState<LoginDetailData | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getLogin(id)
      .then((data) => {
        if (!cancelled) setLogin(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load login');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  useEffect(() => {
    if (!login?.userId) return;
    let cancelled = false;
    api
      .getProfile(login.userId)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [login?.userId]);

  const risk = login?.riskScore;
  const triggeredRules = login?.ruleHits.filter((r) => r.triggered) ?? [];
  const untriggeredRules = login?.ruleHits.filter((r) => !r.triggered) ?? [];
  const f = login?.features;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {loading ? (
        <div className="card flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading login details...
        </div>
      ) : error ? (
        <div className="card flex flex-col items-center gap-3 py-12">
          <p className="text-sm text-risk-high">{error}</p>
          <button onClick={() => setReload((r) => r + 1)} className="btn-ghost">
            <RefreshCw className="mr-1 h-4 w-4" />
            Retry
          </button>
        </div>
      ) : login && risk ? (
        <>
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-white">{login.username}</h2>
                <p className="text-sm text-gray-400">
                  {new Date(login.timestamp).toLocaleString()}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-gray-500">ID: {login.id}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`badge-${risk.label.toLowerCase()}`}>
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  {risk.label}
                </span>
                <span
                  className="text-4xl font-bold"
                  style={{ color: SCORE_COLORS[risk.label] }}
                >
                  {risk.finalScore}
                </span>
              </div>
            </div>
          </div>

          {login.alert && login.alert.status !== 'open' && (
            <div className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-accent">
              <div>
                <h3 className="font-semibold text-white">Triage Status</h3>
                <p className="text-sm text-gray-400">
                  Status{' '}
                  <span className="font-medium text-white">{login.alert.status}</span>
                  {login.alert.resolution
                    ? ` · ${login.alert.resolution.replace(/_/g, ' ')}`
                    : ''}
                  {login.alert.resolvedAt
                    ? ` · ${new Date(login.alert.resolvedAt).toLocaleString()}`
                    : ''}
                </p>
                {login.alert.notes && (
                  <p className="mt-1 text-sm text-gray-300">“{login.alert.notes}”</p>
                )}
              </div>
            </div>
          )}

          {login.aiExplanation && (
            <div className="card border-risk-high/40 bg-risk-high/5">
              <h3 className="flex items-center gap-2 font-semibold text-white">
                <Sparkles className="h-4 w-4 text-amber-400" />
                AI Explanation
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">
                {login.aiExplanation.explanation}
              </p>
              {login.aiExplanation.recommendedAction && (
                <div className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-3">
                  <p className="text-xs uppercase tracking-wide text-amber-400">
                    Recommended Action
                  </p>
                  <p className="mt-1 text-sm text-gray-200">
                    {login.aiExplanation.recommendedAction}
                  </p>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Generated {new Date(login.aiExplanation.generatedAt).toLocaleString()}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="card space-y-3 lg:col-span-1">
              <h3 className="font-semibold text-white">Raw Data</h3>
              {[
                ['IP Address', login.ip],
                ['Country', login.country],
                ['City', login.city],
                ['Device', login.device],
                ['Browser', login.browser],
                ['Timestamp', new Date(login.timestamp).toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">{label}</span>
                  <span className="text-sm font-medium text-white">{value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Status</span>
                {login.success ? (
                  <span className="inline-flex items-center gap-1 text-sm text-risk-low">
                    <CheckCircle2 className="h-4 w-4" /> Success
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm text-risk-critical">
                    <XCircle className="h-4 w-4" /> Failed
                  </span>
                )}
              </div>
            </div>

            <div className="card space-y-4 lg:col-span-2">
              <h3 className="font-semibold text-white">Risk Breakdown</h3>
              <ScoreBar label="Rule Score" value={risk.ruleScore} color="#3b82f6" />
              <ScoreBar label="ML Anomaly Score" value={risk.mlScore} color="#a855f7" />
              <ScoreBar
                label="Threat Intel Score"
                value={risk.threatIntelScore}
                color="#6b7280"
              />
              <div className="border-t border-gray-700/50 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-300">Final Score</span>
                  <span
                    className="text-lg font-bold"
                    style={{ color: SCORE_COLORS[risk.label] }}
                  >
                    {risk.finalScore} · {risk.label}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold text-white">
              Triggered Rules{' '}
              <span className="text-sm font-normal text-gray-500">
                ({triggeredRules.length}/{login.ruleHits.length})
              </span>
            </h3>
            {triggeredRules.length === 0 ? (
              <p className="text-sm text-gray-500">No rules triggered.</p>
            ) : (
              <div className="space-y-2">
                {triggeredRules.map((r) => (
                  <div
                    key={r.ruleName}
                    className="rounded-md border border-risk-critical/30 bg-risk-critical/5 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">
                        {RULE_LABELS[r.ruleName] ?? r.ruleName}
                      </span>
                      <span className="badge-critical">+{r.score ?? 0}</span>
                    </div>
                    {r.details && (
                      <p className="mt-1 text-sm text-gray-300">{r.details}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {untriggeredRules.length > 0 && (
              <div className="border-t border-gray-700/50 pt-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">
                  Not triggered
                </p>
                <div className="flex flex-wrap gap-2">
                  {untriggeredRules.map((r) => (
                    <span key={r.ruleName} className="badge bg-surface-lighter text-gray-400">
                      {RULE_LABELS[r.ruleName] ?? r.ruleName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold text-white">ML Features</h3>
            {!f ? (
              <p className="text-sm text-gray-500">No feature data available.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <FeatureRow label="Login Hour" value={String(f.loginHour)} />
                <FeatureRow label="Day of Week" value={String(f.dayOfWeek)} />
                <FeatureRow
                  label="Failed Attempts (window)"
                  value={String(f.failedAttemptsInWindow)}
                />
                <FeatureRow label="Country Change" value={f.countryChange ? 'Yes' : 'No'} />
                <FeatureRow label="Device Change" value={f.deviceChange ? 'Yes' : 'No'} />
                <FeatureRow label="Browser Change" value={f.browserChange ? 'Yes' : 'No'} />
                <FeatureRow label="IP Change" value={f.ipChange ? 'Yes' : 'No'} />
                <FeatureRow
                  label="Geo Distance"
                  value={`${f.geoDistanceKm.toFixed(1)} km`}
                />
                <FeatureRow
                  label="Account Login Frequency"
                  value={f.accountLoginFrequency.toFixed(2)}
                />
                <FeatureRow
                  label="Historical Success Rate"
                  value={`${(f.historicalSuccessRate * 100).toFixed(1)}%`}
                />
              </div>
            )}
          </div>

          {profile && (
            <div className="card space-y-3">
              <h3 className="font-semibold text-white">
                Profile Comparison{' '}
                <span className="text-sm font-normal text-gray-500">
                  vs {profile.typicalCountry} · {profile.typicalDevice} · {profile.typicalBrowser} · {profile.totalLogins.toLocaleString()} logins
                </span>
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ComparisonRow
                  label="Country"
                  loginValue={login.country}
                  profileValue={profile.typicalCountry}
                />
                <ComparisonRow
                  label="Device"
                  loginValue={login.device}
                  profileValue={profile.typicalDevice}
                />
                <ComparisonRow
                  label="Browser"
                  loginValue={login.browser}
                  profileValue={profile.typicalBrowser}
                />
                <ComparisonRow
                  label="Login Hour"
                  loginValue={String(f?.loginHour ?? '')}
                  profileValue={`${profile.typicalHour}:00`}
                />
                <ComparisonRow
                  label="Daily Login Frequency"
                  loginValue={f ? f.accountLoginFrequency.toFixed(2) : ''}
                  profileValue={
                    profile.avgLoginsPerDay != null
                      ? `${profile.avgLoginsPerDay.toFixed(2)} avg`
                      : null
                  }
                />
                <ComparisonRow
                  label="Historical Success Rate"
                  loginValue={
                    f ? `${(f.historicalSuccessRate * 100).toFixed(1)}%` : ''
                  }
                  profileValue={
                    profile.successRate != null
                      ? `${(profile.successRate * 100).toFixed(1)}%`
                      : null
                  }
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <p className="text-sm text-gray-500">Login not found.</p>
        </div>
      )}
    </div>
  );
}
