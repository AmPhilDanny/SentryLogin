const API_BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'sentry_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface LoginRow {
  id: string;
  username: string;
  timestamp: string;
  ip: string;
  country: string;
  city: string;
  device: string;
  browser: string;
  success: boolean;
}

export interface RiskScore {
  finalScore: number;
  label: 'Low' | 'Medium' | 'High' | 'Critical';
  ruleScore: number;
  mlScore: number;
  threatIntelScore: number;
}

export interface RuleHit {
  ruleName: string;
  triggered: boolean;
  details?: string;
  score?: number;
}

export interface LoginFeatures {
  loginHour: number;
  dayOfWeek: number;
  failedAttemptsInWindow: number;
  countryChange: boolean;
  deviceChange: boolean;
  browserChange: boolean;
  ipChange: boolean;
  geoDistanceKm: number;
  accountLoginFrequency: number;
  historicalSuccessRate: number;
}

export interface LoginDetail extends LoginRow {
  userId: string;
  riskScore: RiskScore;
  ruleHits: RuleHit[];
  features?: LoginFeatures;
  aiExplanation?: AiExplanation | null;
}

export interface AiExplanation {
  explanation: string;
  recommendedAction: string;
  generatedAt: string;
}

export interface UserProfile {
  userId: string;
  username: string;
  totalLogins: number;
  typicalHour: number | null;
  typicalCountry: string | null;
  typicalDevice: string | null;
  typicalBrowser: string | null;
  avgLoginsPerDay: number | null;
  successRate: number | null;
  daysSpan: number;
}

export type AlertStatus = 'open' | 'dismissed' | 'escalated';

export interface AlertItem {
  loginId: string;
  userId: string;
  username: string;
  timestamp: string;
  ip: string;
  country: string;
  city: string;
  device: string;
  browser: string;
  success: boolean;
  finalScore: number;
  label: string;
  status: AlertStatus;
}

export interface Stats {
  total: number;
  flagged: number;
  flaggedPercent: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  topRiskyUser: string | null;
  topScore: number | null;
}

export interface IngestResult {
  total: number;
  valid: number;
  imported: number;
  flagged: number;
  datasetId: string;
  errors: { row: number; message: string }[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type Role = 'analyst' | 'manager' | 'super_admin';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface DatasetItem {
  id: string;
  filename: string;
  rowCount: number;
  importedCount: number;
  flaggedCount: number;
  createdAt: string;
  createdBy: string | null;
}

export interface DatasetPreview {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  total: number;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new Error('Session expired — please log in');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  login(email: string, password: string) {
    return request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  me() {
    return request<AuthUser>('/auth/me');
  },

  getLogins(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<PaginatedResponse<LoginDetail>>(`/logins${qs}`);
  },

  getLogin(id: string) {
    return request<LoginDetail>(`/logins/${id}`);
  },

  getStats() {
    return request<Stats>('/logins/stats');
  },

  getProfile(userId: string) {
    return request<UserProfile>(`/users/${userId}/profile`);
  },

  getAlerts(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<PaginatedResponse<AlertItem>>(`/alerts${qs}`);
  },

  updateAlertStatus(loginId: string, status: AlertStatus) {
    return request<AlertItem>(`/alerts/${loginId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  uploadCsv(file: File) {
    const form = new FormData();
    form.append('file', file);
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${API_BASE}/ingest/csv`, {
      method: 'POST',
      headers,
      body: form,
    }).then((r) => {
      if (r.status === 401) {
        clearToken();
        window.location.href = '/login';
        throw new Error('Session expired — please log in');
      }
      return r.json() as Promise<IngestResult>;
    });
  },

  getDatasets() {
    return request<DatasetItem[]>('/datasets');
  },

  getDatasetPreview(id: string, limit = 50) {
    return request<DatasetPreview>(`/datasets/${id}/preview?limit=${limit}`);
  },

  async downloadDataset(item: DatasetItem) {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/datasets/${item.id}/download`, { headers });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename.replace(/\.csv$/i, '') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  deleteDataset(id: string) {
    return request<{ deleted: boolean }>(`/datasets/${id}`, { method: 'DELETE' });
  },

  getConfig() {
    return request<Record<string, number>>('/config/rules');
  },

  updateConfig(rules: Record<string, number>) {
    return request<Record<string, number>>('/config/rules', {
      method: 'PUT',
      body: JSON.stringify(rules),
    });
  },
};
