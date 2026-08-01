import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Eye,
  ShieldCheck,
  Ban,
} from 'lucide-react';
import { api, AlertItem, AlertStatus } from '../lib/api';

type StatusFilter = 'all' | AlertStatus;

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'dismissed', label: 'Dismissed' },
];

const STATUS_STYLES: Record<AlertStatus, string> = {
  open: 'badge-medium',
  escalated: 'badge-critical',
  dismissed: 'badge-low',
};

export default function Alerts() {
  const navigate = useNavigate();
  const [data, setData] = useState<AlertItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);
  const limit = 20;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (status !== 'all') params.status = status;
    api
      .getAlerts(params)
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setTotal(res.total);
        setTotalPages(Math.max(1, res.totalPages));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load alerts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, status, reload]);

  const handleAction = useCallback(
    async (item: AlertItem, next: AlertStatus) => {
      setActingId(item.loginId);
      try {
        await api.updateAlertStatus(item.loginId, next);
        setReload((r) => r + 1);
      } catch {
        setError('Failed to update alert status');
      } finally {
        setActingId(null);
      }
    },
    [],
  );

  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-white">
          <Bell className="h-6 w-6 text-risk-critical" />
          Alerts
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          High and Critical risk logins requiring triage
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md bg-surface-light p-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => {
                setStatus(t.value);
                setPage(1);
              }}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                status === t.value
                  ? 'bg-accent text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-400">{total.toLocaleString()} alerts</span>
      </div>

      <div className="card">
        {error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-risk-high">{error}</p>
            <button onClick={() => setReload((r) => r + 1)} className="btn-ghost">
              <RefreshCw className="mr-1 h-4 w-4" />
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading alerts...
          </div>
        ) : data.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            No alerts in this state.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-700/50 text-xs uppercase tracking-wide text-gray-400">
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">IP / Location</th>
                    <th className="py-2 pr-3 font-medium">Device / Browser</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Risk</th>
                    <th className="py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((item) => (
                    <tr
                      key={item.loginId}
                      className="border-b border-gray-800/50 transition-colors hover:bg-surface-lighter/40"
                    >
                      <td
                        className="cursor-pointer py-2.5 pr-3 font-medium text-white"
                        onClick={() => navigate(`/logins/${item.loginId}`)}
                      >
                        {item.username}
                      </td>
                      <td className="py-2.5 pr-3 text-gray-300">
                        {new Date(item.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-mono text-xs text-gray-400">{item.ip}</span>
                        <span className="text-gray-500">
                          {' '}
                          ({item.city ? item.city + ', ' : ''}
                          {item.country})
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-gray-300">
                        {item.device} · {item.browser}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={STATUS_STYLES[item.status]}>{item.status}</span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={`badge-${item.label.toLowerCase()}`}>
                          {item.finalScore} · {item.label}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <div className="flex gap-1">
                          {item.status !== 'open' && (
                            <button
                              onClick={() => handleAction(item, 'open')}
                              disabled={actingId === item.loginId}
                              className="btn-ghost px-2 py-1 text-xs"
                              title="Reopen"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {item.status !== 'dismissed' && (
                            <button
                              onClick={() => handleAction(item, 'dismissed')}
                              disabled={actingId === item.loginId}
                              className="btn-ghost px-2 py-1 text-xs"
                              title="Dismiss"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {item.status !== 'escalated' && (
                            <button
                              onClick={() => handleAction(item, 'escalated')}
                              disabled={actingId === item.loginId}
                              className="btn-ghost px-2 py-1 text-xs"
                              title="Escalate"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => navigate(`/logins/${item.loginId}`)}
                            className="btn-ghost px-2 py-1 text-xs"
                            title="View details"
                          >
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-400">
              <span>
                {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn-ghost px-3 py-1.5 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="btn-ghost px-3 py-1.5 disabled:opacity-40"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <CheckCircle2 className="h-4 w-4 text-risk-low" />
        Dismissed alerts are hidden from the open queue but kept for audit.
        <XCircle className="ml-3 h-4 w-4 text-risk-critical" />
        Escalated alerts are flagged for human investigation.
      </div>
    </div>
  );
}
