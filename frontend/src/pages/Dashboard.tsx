import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Users,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  ArrowUpDown,
  FileText,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { api, Stats, LoginDetail, DatasetItem } from '../lib/api';

const RISK_COLORS: Record<string, string> = {
  Low: '#22c55e',
  Medium: '#eab308',
  High: '#f97316',
  Critical: '#ef4444',
};

const SORT_OPTIONS = [
  { value: 'timestamp', label: 'Timestamp' },
  { value: 'score', label: 'Risk Score' },
  { value: 'label', label: 'Risk Label' },
  { value: 'user', label: 'User' },
  { value: 'ip', label: 'IP' },
  { value: 'country', label: 'Country' },
];

interface Filters {
  user: string;
  risk: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = { user: '', risk: '', dateFrom: '', dateTo: '' };

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [data, setData] = useState<LoginDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('timestamp');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');

  const limit = 20;

  useEffect(() => {
    let cancelled = false;
    api
      .getDatasets()
      .then((list) => {
        if (cancelled) return;
        setDatasets(list);
        if (list.length > 0 && !selectedDatasetId) {
          setSelectedDatasetId(list[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) setDatasets([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  // Debounced user search -> filters.user, reset to page 1
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.user === search ? f : { ...f, user: search }));
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // Summary stats (re-fetch when scope changes)
  useEffect(() => {
    api
      .getStats(selectedDatasetId || undefined)
      .then(setStats)
      .catch(() => setStats(null));
  }, [reload, selectedDatasetId]);

  // Logins list
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params: Record<string, string> = { page: String(page), limit: String(limit), sortBy, sortOrder };
    if (filters.user) params.user = filters.user;
    if (filters.risk) params.risk = filters.risk;
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
    if (selectedDatasetId) params.datasetId = selectedDatasetId;
    api
      .getLogins(params)
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setTotal(res.total);
        setTotalPages(Math.max(1, res.totalPages));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load logins');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, filters, sortBy, sortOrder, reload, selectedDatasetId]);

  const handleSort = (value: string) => {
    if (value === sortBy) {
      setSortOrder((o) => (o === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      setSortBy(value);
      setSortOrder(value === 'score' || value === 'timestamp' ? 'DESC' : 'ASC');
    }
    setPage(1);
  };

  const handleRetry = useCallback(() => setReload((r) => r + 1), []);

  const riskData = stats
    ? [
        { name: 'Critical', value: stats.critical },
        { name: 'High', value: stats.high },
        { name: 'Medium', value: stats.medium },
        { name: 'Low', value: stats.low },
      ]
    : [];

  const summaryCards = [
    { label: 'Total Logins', value: stats ? stats.total.toLocaleString() : '—', icon: Activity, color: 'text-blue-400' },
    {
      label: 'Flagged',
      value: stats ? stats.flagged.toLocaleString() : '—',
      sub: stats ? `${stats.flaggedPercent}% of total` : undefined,
      icon: AlertTriangle,
      color: 'text-risk-high',
    },
    { label: 'Critical Alerts', value: stats ? stats.critical.toLocaleString() : '—', icon: ShieldAlert, color: 'text-risk-critical' },
    {
      label: 'Top Risky User',
      value: stats?.topRiskyUser ? stats.topRiskyUser : '—',
      sub: stats?.topScore != null ? `Score ${stats.topScore}` : undefined,
      icon: Users,
      color: 'text-purple-400',
    },
  ];

  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  const currentDataset = datasets.find((d) => d.id === selectedDatasetId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="mt-1 text-sm text-gray-400">
          Overview of login activity and risk analysis
        </p>
      </div>

      {datasets.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-accent" />
            <div>
              <p className="text-xs text-gray-500">Current dataset</p>
              <p className="text-sm font-semibold text-white" title={currentDataset?.filename}>
                {currentDataset?.filename ?? 'All data'}
              </p>
            </div>
            {currentDataset && (
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span>{currentDataset.rowCount.toLocaleString()} rows</span>
                <span className="text-risk-low">{currentDataset.importedCount.toLocaleString()} imported</span>
                <span className={currentDataset.flaggedCount > 0 ? 'text-risk-high' : 'text-risk-low'}>
                  {currentDataset.flaggedCount.toLocaleString()} flagged
                </span>
              </div>
            )}
          </div>
          <select
            className="input w-64"
            value={selectedDatasetId}
            onChange={(e) => {
              setSelectedDatasetId(e.target.value);
              setPage(1);
            }}
            title="Scope the dashboard to one dataset"
          >
            <option value="">All data</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map(({ label, value, sub, icon: Icon, color }) => (
          <div key={label} className="card">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">{label}</span>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <p className="mt-2 truncate text-3xl font-bold text-white" title={value}>{value}</p>
            {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
          </div>
        ))}
      </div>

      {stats && (
        <div className="card">
          <h3 className="mb-4 font-semibold text-white">Risk Distribution</h3>
          <div className="flex flex-col items-center gap-6 md:flex-row">
            <div className="h-56 w-full max-w-xs">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={riskData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {riskData.map((entry) => (
                      <Cell key={entry.name} fill={RISK_COLORS[entry.name]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e5e7eb' }}
                    itemStyle={{ color: '#e5e7eb' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid w-full max-w-md grid-cols-2 gap-3">
              {riskData.map((d) => (
                <div key={d.name} className="flex items-center justify-between rounded-md border border-gray-700/50 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm text-gray-300">
                    <span className="h-3 w-3 rounded-full" style={{ background: RISK_COLORS[d.name] }} />
                    {d.name}
                  </span>
                  <span className="text-sm font-semibold text-white">{d.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-700/50 pb-3">
          <h3 className="font-semibold text-white">Recent Logins</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search user..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input w-48"
            />
            <select
              className="input w-36"
              value={filters.risk}
              onChange={(e) => {
                setFilters((f) => ({ ...f, risk: e.target.value }));
                setPage(1);
              }}
            >
              <option value="">All Risk Levels</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </select>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => {
                setFilters((f) => ({ ...f, dateFrom: e.target.value }));
                setPage(1);
              }}
              className="input w-40"
              title="From date"
            />
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => {
                setFilters((f) => ({ ...f, dateTo: e.target.value }));
                setPage(1);
              }}
              className="input w-40"
              title="To date"
            />
            <select
              className="input w-40"
              value={sortBy}
              onChange={(e) => handleSort(e.target.value)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  Sort: {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSortOrder((o) => (o === 'ASC' ? 'DESC' : 'ASC'))}
              className="btn-ghost"
              title={`Direction: ${sortOrder}`}
            >
              <ArrowUpDown className="mr-1 h-4 w-4" />
              {sortOrder}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-6 flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-risk-high">{error}</p>
            <button onClick={handleRetry} className="btn-ghost">
              <RefreshCw className="mr-1 h-4 w-4" />
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="mt-6 flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading logins...
          </div>
        ) : data.length === 0 ? (
          <p className="mt-6 py-8 text-center text-sm text-gray-500">
            No logins match your filters.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-700/50 text-xs uppercase tracking-wide text-gray-400">
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">IP</th>
                    <th className="py-2 pr-3 font-medium">Country</th>
                    <th className="py-2 pr-3 font-medium">Device / Browser</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => navigate(`/logins/${row.id}`)}
                      className="cursor-pointer border-b border-gray-800/50 transition-colors hover:bg-surface-lighter/40"
                    >
                      <td className="py-2.5 pr-3 font-medium text-white">{row.username}</td>
                      <td className="py-2.5 pr-3 text-gray-300">
                        {new Date(row.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-gray-400">{row.ip}</td>
                      <td className="py-2.5 pr-3 text-gray-300">
                        {row.country}
                        {row.city ? <span className="text-gray-500"> · {row.city}</span> : null}
                      </td>
                      <td className="py-2.5 pr-3 text-gray-300">
                        {row.device} · {row.browser}
                      </td>
                      <td className="py-2.5 pr-3">
                        {row.success ? (
                          <span className="inline-flex items-center gap-1 text-risk-low">
                            <CheckCircle2 className="h-4 w-4" /> Success
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-risk-critical">
                            <XCircle className="h-4 w-4" /> Failed
                          </span>
                        )}
                      </td>
                      <td className="py-2.5">
                        {row.riskScore && (
                          <span className={`badge-${row.riskScore.label.toLowerCase()}`}>
                            {row.riskScore.finalScore} · {row.riskScore.label}
                          </span>
                        )}
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
    </div>
  );
}
