import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Eye,
  ShieldCheck,
  Ban,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { api, AlertItem, AlertStatus, AlertResolution } from '../lib/api';
import { useAuth } from '../lib/auth';

type StatusFilter = 'all' | AlertStatus;

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'investigated', label: 'Investigating' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

const STATUS_STYLES: Record<AlertStatus, string> = {
  open: 'badge-medium',
  escalated: 'badge-critical',
  investigated: 'badge-high',
  resolved: 'badge-low',
  dismissed: 'badge bg-surface-lighter text-gray-400',
};

const RESOLUTION_LABELS: Record<AlertResolution, string> = {
  fraud: 'Fraud confirmed',
  positive: 'Positive (real threat)',
  false_positive: 'False positive',
  no_action: 'No action needed',
};

const RESOLUTION_OPTIONS: AlertResolution[] = [
  'fraud',
  'positive',
  'false_positive',
  'no_action',
];

export default function Alerts() {
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const canAct = hasRole(['manager', 'super_admin']);
  const [data, setData] = useState<AlertItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<AlertResolution>('fraud');
  const [notes, setNotes] = useState('');
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
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update alert status');
      } finally {
        setActingId(null);
      }
    },
    [],
  );

  const handleResolve = useCallback(
    async (item: AlertItem) => {
      setActingId(item.loginId);
      try {
        await api.resolveAlert(item.loginId, resolution, notes.trim() || undefined);
        setResolvingId(null);
        setNotes('');
        setReload((r) => r + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to resolve alert');
      } finally {
        setActingId(null);
      }
    },
    [resolution, notes],
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
        <div className="flex flex-wrap gap-1 rounded-md bg-surface-light p-1">
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
                    <AlertRow
                      key={item.loginId}
                      item={item}
                      canAct={canAct}
                      acting={actingId === item.loginId}
                      resolving={resolvingId === item.loginId}
                      resolution={resolution}
                      notes={notes}
                      onResolutionChange={setResolution}
                      onNotesChange={setNotes}
                      onStartResolve={() => setResolvingId(item.loginId)}
                      onCancelResolve={() => setResolvingId(null)}
                      onAction={handleAction}
                      onResolve={handleResolve}
                      onOpen={() => navigate(`/logins/${item.loginId}`)}
                    />
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Ban className="h-3.5 w-3.5 text-gray-500" />
          Dismissed: analyst cleared it, kept for audit.
        </span>
        <span className="flex items-center gap-1">
          <ShieldAlert className="h-3.5 w-3.5 text-risk-high" />
          Escalated / Investigating: flagged for human review.
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-risk-low" />
          Resolved: closed with a recorded outcome.
        </span>
        {user && (
          <span className="ml-auto text-gray-600">
            acting as {user.displayName ?? user.email}
          </span>
        )}
      </div>
    </div>
  );
}

function AlertRow({
  item,
  canAct,
  acting,
  resolving,
  resolution,
  notes,
  onResolutionChange,
  onNotesChange,
  onStartResolve,
  onCancelResolve,
  onAction,
  onResolve,
  onOpen,
}: {
  item: AlertItem;
  canAct: boolean;
  acting: boolean;
  resolving: boolean;
  resolution: AlertResolution;
  notes: string;
  onResolutionChange: (r: AlertResolution) => void;
  onNotesChange: (n: string) => void;
  onStartResolve: () => void;
  onCancelResolve: () => void;
  onAction: (item: AlertItem, next: AlertStatus) => void;
  onResolve: (item: AlertItem) => void;
  onOpen: () => void;
}) {
  return (
    <tr className="border-b border-gray-800/50 align-top transition-colors hover:bg-surface-lighter/40">
      <td className="cursor-pointer py-2.5 pr-3 font-medium text-white" onClick={onOpen}>
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
        <div className="flex flex-col gap-1">
          <span className={STATUS_STYLES[item.status]}>{item.status}</span>
          {item.status === 'resolved' && item.resolution && (
            <span className="text-[11px] text-gray-400">
              {RESOLUTION_LABELS[item.resolution]}
              {item.resolvedBy ? ` · ${item.resolvedBy.slice(0, 8)}` : ''}
            </span>
          )}
        </div>
      </td>
      <td className="py-2.5 pr-3">
        <span className={`badge-${item.label.toLowerCase()}`}>
          {item.finalScore} · {item.label}
        </span>
      </td>
      <td className="py-2.5">
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1">
            {canAct && item.status !== 'open' && (
              <button
                onClick={() => onAction(item, 'open')}
                disabled={acting}
                className="btn-ghost px-2 py-1 text-xs"
                title="Reopen"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            )}
            {canAct && item.status === 'open' && (
              <>
                <button
                  onClick={() => onAction(item, 'dismissed')}
                  disabled={acting}
                  className="btn-ghost px-2 py-1 text-xs"
                  title="Dismiss"
                >
                  <Ban className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onAction(item, 'escalated')}
                  disabled={acting}
                  className="btn-ghost px-2 py-1 text-xs"
                  title="Escalate"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {canAct && item.status === 'escalated' && (
              <>
                <button
                  onClick={() => onAction(item, 'investigated')}
                  disabled={acting}
                  className="btn-ghost px-2 py-1 text-xs"
                  title="Start investigation"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
                {!resolving && (
                  <button
                    onClick={onStartResolve}
                    disabled={acting}
                    className="btn-ghost px-2 py-1 text-xs"
                    title="Resolve"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}
            {canAct && item.status === 'investigated' && !resolving && (
              <button
                onClick={onStartResolve}
                disabled={acting}
                className="btn-ghost px-2 py-1 text-xs"
                title="Resolve with outcome"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={onOpen}
              className="btn-ghost px-2 py-1 text-xs"
              title="View details"
            >
              Details
            </button>
          </div>

          {resolving && (
            <div className="flex flex-col gap-1.5 rounded-md border border-gray-700/50 bg-surface-lighter/40 p-2">
              <select
                className="input w-full"
                value={resolution}
                onChange={(e) => onResolutionChange(e.target.value as AlertResolution)}
              >
                {RESOLUTION_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {RESOLUTION_LABELS[r]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className="input w-full"
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
              />
              <div className="flex gap-1.5">
                <button
                  onClick={() => onResolve(item)}
                  disabled={acting}
                  className="btn px-2 py-1 text-xs"
                >
                  {acting ? 'Saving…' : 'Confirm'}
                </button>
                <button onClick={onCancelResolve} className="btn-ghost px-2 py-1 text-xs">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {item.status === 'escalated' && !resolving && (
            <button
              onClick={() => onAction(item, 'investigated')}
              disabled={acting}
              className="btn-ghost px-2 py-1 text-xs"
              title="Start investigation"
            >
              <Search className="mr-1 h-3.5 w-3.5" />
              Investigate
            </button>
          )}

          {item.status === 'resolved' && item.notes && (
            <span className="text-[11px] text-gray-500">“{item.notes}”</span>
          )}
        </div>
      </td>
    </tr>
  );
}