import { Injectable, BadRequestException } from '@nestjs/common';
import {
  AiProviderId,
  DEFAULT_PROVIDER_BASE_URLS,
} from './ai-settings.entity';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompleteOptions {
  provider: AiProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiTestInput {
  provider: AiProviderId;
  baseUrl?: string;
  apiKey: string;
  model: string;
}

export interface AiTestResult {
  ok: boolean;
  provider: AiProviderId;
  model: string;
  message: string;
  reply?: string;
}

export interface AiCompleteResult {
  provider: AiProviderId;
  model: string;
  content: string;
}

interface JsonResponse {
  text: string;
}

/**
 * Unified gateway over three LLM providers.
 *  - Mistral / OpenRouter: OpenAI-style /chat/completions
 *  - Gemini: generateContent
 * Each provider is resolved from *settings-supplied* baseUrl/model/apiKey — nothing
 * is hardcoded; the caller decides which model to use.
 */
@Injectable()
export class AiGatewayService {
  async test(input: AiTestInput): Promise<AiTestResult> {
    const result = await this.completeRaw({
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl || DEFAULT_PROVIDER_BASE_URLS[input.provider],
      apiKey: input.apiKey,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      maxTokens: 5,
    });
    return {
      ok: true,
      provider: input.provider,
      model: input.model,
      message: 'Connection OK',
      reply: result.text,
    };
  }

  /** Call a provider with the given config; returns the assistant text. */
  async completeRaw(options: AiCompleteOptions): Promise<JsonResponse> {
    const { provider, model, baseUrl } = options;
    if (!model.trim()) {
      throw new BadRequestException(`Model is required for provider "${provider}". Configure a model in Settings.`);
    }
    if (!options.apiKey) {
      throw new BadRequestException(`API key is required for provider "${provider}". Configure the key in Settings.`);
    }

    const url = this.buildUrl(provider, baseUrl, model);
    const headers = this.buildHeaders(provider, options.apiKey);
    const body = this.buildBody(provider, options);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      throw new BadRequestException(
        `Failed to reach ${provider} at ${url}. Check base URL / connectivity.`,
      );
    }
    clearTimeout(timeout);

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new BadRequestException(
        `${provider} API error (${res.status}): ${raw.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as unknown;
    return { text: this.extractText(provider, data) };
  }

  private buildUrl(
    provider: AiProviderId,
    baseUrl: string,
    model: string,
  ): string {
    const base = baseUrl.replace(/\/+$/, '');
    if (provider === 'gemini') {
      return `${base}/models/${encodeURIComponent(model)}:generateContent`;
    }
    return `${base}/chat/completions`;
  }

  private buildHeaders(provider: AiProviderId, apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (provider === 'gemini') {
      headers['x-goog-api-key'] = apiKey;
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  private buildBody(provider: AiProviderId, cfg: AiCompleteOptions): unknown {
    if (provider === 'gemini') {
      return {
        contents: cfg.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        generationConfig: {
          temperature: cfg.temperature ?? 0.2,
          maxOutputTokens: cfg.maxTokens ?? 1024,
        },
      };
    }
    return {
      model: cfg.model,
      messages: cfg.messages,
      temperature: cfg.temperature ?? 0.2,
      max_tokens: cfg.maxTokens ?? 1024,
    };
  }

  private extractText(provider: AiProviderId, data: unknown): string {
    if (provider === 'gemini') {
      const candidates = (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
        ?.candidates;
      return candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('') ?? '';
    }
    const choices = (data as { choices?: { message?: { content?: string } }[] })?.choices;
    return choices?.[0]?.message?.content ?? '';
  }
}