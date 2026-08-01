const API_BASE = import.meta.env.VITE_API_URL || '/api';

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
  errors: { row: number; message: string }[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
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
    return fetch(`${API_BASE}/ingest/csv`, { method: 'POST', body: form }).then(
      (r) => r.json() as Promise<IngestResult>,
    );
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
