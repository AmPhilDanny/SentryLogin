import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import {
  AiSettings,
  AiProviderId,
  AiProviderConfig,
  AiProviders,
  AI_PROVIDER_IDS,
  DEFAULT_PROVIDER_BASE_URLS,
} from './ai-settings.entity';

const SETTINGS_ID = 'default';
const KEY_PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

/** Public-safe shape of a provider (apiKey is masked / never exposed). */
export interface PublicAiProvider {
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
  configured: boolean;
}

export interface PublicAiSettings {
  defaultProvider: AiProviderId | null;
  providers: Record<AiProviderId, PublicAiProvider>;
}

export interface SaveProviderInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
  enabled: boolean;
}

export interface ResolvedProvider {
  config: AiProviderConfig;
  key: string | null;
}

const MASK = '••••';

function maskKey(apiKey: string | null | undefined): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return MASK;
  return `${MASK}${apiKey.slice(-4)}`;
}

class Encryptor {
  private readonly key: Buffer;

  constructor(secret: string | undefined) {
    this.key = createHash('sha256').update(secret || 'sentry-dev-fallback').digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${KEY_PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
  }

  decrypt(value: string): string | null {
    if (!value.startsWith(KEY_PREFIX)) return value;
    const parts = value.slice(KEY_PREFIX.length).split('.');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, encB64] = parts;
    try {
      const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      const dec = Buffer.concat([
        decipher.update(Buffer.from(encB64, 'base64')),
        decipher.final(),
      ]);
      return dec.toString('utf8');
    } catch {
      return null;
    }
  }

  looksStored(value: string): boolean {
    return value.startsWith(KEY_PREFIX);
  }
}

function isFullKey(value: string | undefined, stored: string | undefined): boolean {
  if (!value) return false;
  if (value.startsWith(MASK) || value === maskKey(stored)) return false;
  return true;
}

@Injectable()
export class AiSettingsService implements OnModuleInit {
  private readonly enc: Encryptor;

  constructor(
    @InjectRepository(AiSettings)
    private readonly repo: Repository<AiSettings>,
  ) {
    this.enc = new Encryptor(process.env.AI_ENC_SECRET);
  }

  async onModuleInit(): Promise<void> {
    const row = await this.repo.findOne({ where: { id: SETTINGS_ID } });
    if (!row) {
      await this.repo.save(this.emptyRow());
    }
  }

  private emptyRow(): AiSettings {
    const providers: AiProviders = {};
    for (const id of AI_PROVIDER_IDS) {
      providers[id] = {
        baseUrl: DEFAULT_PROVIDER_BASE_URLS[id],
        model: '',
        apiKey: '',
        enabled: false,
      };
    }
    return { id: SETTINGS_ID, defaultProvider: null, providers } as AiSettings;
  }

  private async row(): Promise<AiSettings> {
    const existing = await this.repo.findOne({ where: { id: SETTINGS_ID } });
    if (existing) return existing;
    return this.repo.save(this.emptyRow());
  }

  /** Public settings; every apiKey masked so the full key never leaves the server. */
  async getPublic(): Promise<PublicAiSettings> {
    const row = await this.row();
    return {
      defaultProvider: row.defaultProvider ?? null,
      providers: this.toPublic(row.providers ?? {}),
    };
  }

  async save(input: {
    defaultProvider?: AiProviderId | null;
    providers?: Partial<Record<AiProviderId, SaveProviderInput>>;
  }): Promise<PublicAiSettings> {
    const row = await this.row();
    const providers = { ...(row.providers ?? {}) } as AiProviders;

    for (const id of AI_PROVIDER_IDS) {
      const inc = input.providers?.[id];
      if (!inc) continue;
      const current = providers[id];
      let storedKey = current?.apiKey ?? '';

      if (isFullKey(inc.apiKey, current?.apiKey)) {
        storedKey = this.enc.encrypt(inc.apiKey as string);
      } else if (inc.apiKey === '') {
        storedKey = '';
      }
      // masked / omitted → keep existing stored key

      providers[id] = {
        baseUrl: inc.baseUrl || DEFAULT_PROVIDER_BASE_URLS[id],
        model: inc.model ?? current?.model ?? '',
        apiKey: storedKey,
        enabled: inc.enabled ?? current?.enabled ?? false,
      };
    }

    const saved = await this.repo.save({
      id: SETTINGS_ID,
      defaultProvider:
        input.defaultProvider !== undefined
          ? input.defaultProvider
          : row.defaultProvider ?? null,
      providers,
    } as AiSettings);

    return {
      defaultProvider: saved.defaultProvider ?? null,
      providers: this.toPublic(saved.providers ?? {}),
    };
  }

  /** Decrypted key + config for a provider; key null if none configured. */
  async resolve(provider: AiProviderId): Promise<ResolvedProvider> {
    const row = await this.row();
    const cfg = row.providers?.[provider];
    const baseCfg: AiProviderConfig = cfg ?? {
      baseUrl: DEFAULT_PROVIDER_BASE_URLS[provider],
      model: '',
      apiKey: '',
      enabled: false,
    };
    if (!cfg?.apiKey) return { config: baseCfg, key: null };
    return { config: baseCfg, key: this.enc.decrypt(cfg.apiKey) };
  }

  async getDefaultProviderId(): Promise<AiProviderId | null> {
    const row = await this.row();
    return row.defaultProvider ?? null;
  }

  private toPublic(providers: AiProviders): Record<AiProviderId, PublicAiProvider> {
    const out = {} as Record<AiProviderId, PublicAiProvider>;
    for (const id of AI_PROVIDER_IDS) {
      const cfg = providers[id];
      out[id] = {
        baseUrl: cfg?.baseUrl ?? DEFAULT_PROVIDER_BASE_URLS[id],
        model: cfg?.model ?? '',
        apiKey: maskKey(cfg?.apiKey),
        enabled: cfg?.enabled ?? false,
        configured: Boolean(cfg?.apiKey && cfg.model),
      };
    }
    return out;
  }
}