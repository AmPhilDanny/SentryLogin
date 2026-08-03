import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  KeyRound,
  Globe,
  CheckCircle2,
  XCircle,
  Save,
  Loader2,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { api, AiProviderId, AiProviderSettings } from '../lib/api';
import type { AiSettings } from '../lib/api';

const PROVIDER_IDS: AiProviderId[] = ['mistral', 'openrouter', 'gemini'];

const PROVIDER_META: Record<AiProviderId, { name: string; hint: string }> = {
  mistral: { name: 'Mistral', hint: 'https://api.mistral.ai/v1' },
  openrouter: { name: 'OpenRouter', hint: 'https://openrouter.ai/api/v1' },
  gemini: { name: 'Gemini', hint: 'https://generativelanguage.googleapis.com/v1beta' },
};

type ProviderForm = {
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
};

type TestResult = { ok: boolean; message: string; reply?: string };

const EMPTY_FORM: ProviderForm = { baseUrl: '', model: '', apiKey: '', enabled: false };

function isMasked(value: string): boolean {
  return value.includes('•');
}

export default function AiSettings() {
  const [defaultProvider, setDefaultProvider] = useState<AiProviderId | ''>('');
  const [forms, setForms] = useState<Record<AiProviderId, ProviderForm>>({
    mistral: { ...EMPTY_FORM },
    openrouter: { ...EMPTY_FORM },
    gemini: { ...EMPTY_FORM },
  });
  const [configured, setConfigured] = useState<Record<AiProviderId, boolean>>({
    mistral: false,
    openrouter: false,
    gemini: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [testing, setTesting] = useState<AiProviderId | null>(null);
  const [results, setResults] = useState<Record<AiProviderId, TestResult | null>>({
    mistral: null,
    openrouter: null,
    gemini: null,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getAiSettings()
      .then((s: AiSettings) => {
        if (cancelled) return;
        setDefaultProvider(s.defaultProvider ?? '');
        setConfigured({
          mistral: s.providers.mistral?.configured ?? false,
          openrouter: s.providers.openrouter?.configured ?? false,
          gemini: s.providers.gemini?.configured ?? false,
        });
        setForms({
          mistral: toForm(s.providers.mistral),
          openrouter: toForm(s.providers.openrouter),
          gemini: toForm(s.providers.gemini),
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load AI settings');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const updateForm = useCallback((id: AiProviderId, patch: Partial<ProviderForm>) => {
    setForms((f) => ({ ...f, [id]: { ...f[id], ...patch } }));
  }, []);

  const handleTest = useCallback(
    async (id: AiProviderId) => {
      const f = forms[id];
      if (!f.model.trim()) {
        setResults((r) => ({ ...r, [id]: { ok: false, message: 'Enter a model id first' } }));
        return;
      }
      setTesting(id);
      setResults((r) => ({ ...r, [id]: null }));
      try {
        const res = await api.testAiProvider({
          provider: id,
          baseUrl: f.baseUrl.trim() || undefined,
          apiKey: f.apiKey,
          model: f.model.trim(),
        });
        setResults((r) => ({
          ...r,
          [id]: {
            ok: res.ok,
            message: res.message,
            reply: res.reply,
          },
        }));
      } catch (e) {
        setResults((r) => ({
          ...r,
          [id]: { ok: false, message: e instanceof Error ? e.message : 'Test failed' },
        }));
      } finally {
        setTesting(null);
      }
    },
    [forms],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSavedNote(null);
    try {
      await api.updateAiSettings({
        defaultProvider: defaultProvider || null,
        providers: {
          mistral: toSave(forms.mistral),
          openrouter: toSave(forms.openrouter),
          gemini: toSave(forms.gemini),
        },
      });
      setSavedNote('Settings saved');
      setReload((r) => r + 1);
      window.setTimeout(() => setSavedNote(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [defaultProvider, forms]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-white">
          <Sparkles className="h-6 w-6 text-accent" />
          AI Settings
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          API keys are encrypted at rest and never returned — only masked previews.
        </p>
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-risk-critical/40 bg-surface-light p-4">
          <p className="text-sm text-risk-high">{error}</p>
          <button onClick={() => setReload((r) => r + 1)} className="btn-ghost">
            <RefreshCw className="mr-1 h-4 w-4" />
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="card">
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading settings...
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <label className="block text-sm font-medium text-gray-300">
              Default provider
            </label>
            <p className="mt-0.5 text-xs text-gray-500">
              Used when AI features run without an explicit provider.
            </p>
            <select
              className="input mt-2 max-w-xs"
              value={defaultProvider}
              onChange={(e) => setDefaultProvider(e.target.value as AiProviderId | '')}
            >
              <option value="">None</option>
              {PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_META[id].name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PROVIDER_IDS.map((id) => (
              <ProviderCard
                key={id}
                meta={PROVIDER_META[id]}
                form={forms[id]}
                configured={configured[id]}
                testing={testing === id}
                result={results[id]}
                onChange={(patch) => updateForm(id, patch)}
                onTest={() => handleTest(id)}
              />
            ))}
          </div>

          <div className="sticky bottom-0 flex items-center gap-3 border-t border-gray-700/50 bg-surface/95 py-3 backdrop-blur">
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save settings
            </button>
            {savedNote && (
              <span className="flex items-center gap-1 text-sm text-risk-low">
                <CheckCircle2 className="h-4 w-4" />
                {savedNote}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function toForm(p: AiProviderSettings | undefined): ProviderForm {
  return {
    baseUrl: p?.baseUrl ?? '',
    model: p?.model ?? '',
    apiKey: p?.apiKey ?? '',
    enabled: p?.enabled ?? false,
  };
}

function toSave(f: ProviderForm) {
  return {
    baseUrl: f.baseUrl,
    model: f.model,
    apiKey: f.apiKey,
    enabled: f.enabled,
  };
}

function ProviderCard({
  meta,
  form,
  configured,
  testing,
  result,
  onChange,
  onTest,
}: {
  meta: { name: string; hint: string };
  form: ProviderForm;
  configured: boolean;
  testing: boolean;
  result: TestResult | null;
  onChange: (patch: Partial<ProviderForm>) => void;
  onTest: () => void;
}) {
  const masked = isMasked(form.apiKey);
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-white">
          <ShieldCheck className="h-4 w-4 text-accent" />
          {meta.name}
        </h3>
        <div className="flex items-center gap-2">
          {configured && <span className="badge-low">configured</span>}
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 accent-accent"
            />
            enabled
          </label>
        </div>
      </div>

      <label className="block">
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Globe className="h-3 w-3" /> Base URL
        </span>
        <input
          type="text"
          className="input mt-1"
          value={form.baseUrl}
          placeholder={meta.hint}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
        />
      </label>

      <label className="block">
        <span className="text-xs text-gray-400">Model</span>
        <input
          type="text"
          className="input mt-1"
          value={form.model}
          placeholder="Model id, e.g. gemini-1.5-flash"
          onChange={(e) => onChange({ model: e.target.value })}
        />
      </label>

      <label className="block">
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <KeyRound className="h-3 w-3" /> API key
        </span>
        <input
          type="password"
          className="input mt-1"
          value={form.apiKey}
          placeholder="Paste API key"
          onChange={(e) => onChange({ apiKey: e.target.value })}
        />
        {masked && (
          <span className="mt-1 block text-[11px] text-gray-500">
            Key stored — leave unchanged to keep, clear to remove.
          </span>
        )}
      </label>

      <div className="mt-auto flex flex-col gap-2">
        <button onClick={onTest} disabled={testing} className="btn-ghost w-full">
          {testing ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-1 h-4 w-4" />
          )}
          Test connection
        </button>
        {result && (
          <div
            className={`flex items-start gap-1.5 rounded-md border p-2 text-xs ${
              result.ok
                ? 'border-risk-low/40 bg-risk-low/10 text-risk-low'
                : 'border-risk-critical/40 bg-risk-critical/10 text-risk-high'
            }`}
          >
            {result.ok ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {result.message}
              {result.ok && result.reply ? ` — ${result.reply.slice(0, 200)}` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
