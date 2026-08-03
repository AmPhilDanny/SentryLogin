import { Entity, PrimaryColumn, Column } from 'typeorm';

export type AiProviderId = 'mistral' | 'openrouter' | 'gemini';

export interface AiProviderConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
}

export type AiProviders = Partial<Record<AiProviderId, AiProviderConfig>>;

export const AI_PROVIDER_IDS: AiProviderId[] = [
  'mistral',
  'openrouter',
  'gemini',
];

export const DEFAULT_PROVIDER_BASE_URLS: Record<AiProviderId, string> = {
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

@Entity('ai_settings')
export class AiSettings {
  @PrimaryColumn()
  id!: string;

  @Column({ name: 'default_provider', type: 'text', nullable: true })
  defaultProvider!: AiProviderId | null;

  /** Stored as JSON: providerId → AiProviderConfig (apiKey kept server-side). */
  @Column({ name: 'providers', type: 'simple-json', nullable: true })
  providers!: AiProviders | null;
}