import { AiSettingsService, PublicAiSettings } from './ai-settings.service';
import { AiSettings } from './ai-settings.entity';
import { Repository } from 'typeorm';

const MASK = '••••';

function makeService(): { service: AiSettingsService; saved: AiSettings[] } {
  const saved: AiSettings[] = [];
  const repo = {
    findOne: jest.fn(async () => saved[saved.length - 1] ?? null),
    save: jest.fn(async (r: AiSettings) => {
      saved.push(r);
      return r;
    }),
  } as unknown as Repository<AiSettings>;
  return { service: new AiSettingsService(repo), saved };
}

describe('AiSettingsService', () => {
  it('returns empty default settings with masked keys', async () => {
    const { service } = makeService();
    const pub = await service.getPublic();
    expect(pub.defaultProvider).toBeNull();
    expect(pub.providers.mistral.apiKey).toBe('');
    expect(pub.providers.gemini.apiKey).toBe('');
  });

  it('never returns the full api key from getPublic', async () => {
    const { service } = makeService();
    await service.save({
      defaultProvider: 'mistral',
      providers: {
        mistral: { baseUrl: '', model: 'mistral-large-latest', apiKey: 'secret-key-123456', enabled: true },
      },
    });
    const pub = await service.getPublic();
    expect(pub.providers.mistral.apiKey).toContain(MASK);
    expect(pub.providers.mistral.apiKey).not.toContain('secret-key-123456');
    expect(pub.providers.mistral.configured).toBe(true);
  });

  it('persists encrypted key and resolves the decrypted original', async () => {
    const { service, saved } = makeService();
    await service.save({
      defaultProvider: null,
      providers: {
        mistral: { baseUrl: '', model: 'mistral-large-latest', apiKey: 'sk-abc-1234567890', enabled: true },
      },
    });
    const savedRow = saved[saved.length - 1];
    expect(savedRow.providers?.mistral?.apiKey.startsWith('enc:v1:')).toBe(true);
    expect(savedRow.providers?.mistral?.apiKey).not.toContain('sk-abc-1234567890');

    const resolved = await service.resolve('mistral');
    expect(resolved.key).toBe('sk-abc-1234567890');
  });

  it('keeps the stored key when the incoming apiKey is masked or empty', async () => {
    const { service } = makeService();
    await service.save({
      defaultProvider: null,
      providers: {
        mistral: { baseUrl: '', model: 'mistral-large-latest', apiKey: 'sk-keep-me-1234567890', enabled: true },
      },
    });
    await service.save({
      defaultProvider: null,
      providers: {
        mistral: { baseUrl: '', model: 'mistral-large-latest', apiKey: `${MASK}7890`, enabled: true },
      },
    });
    const resolved = await service.resolve('mistral');
    expect(resolved.key).toBe('sk-keep-me-1234567890');
  });

  it('clears the stored key when the incoming apiKey is an empty string', async () => {
    const { service } = makeService();
    await service.save({
      defaultProvider: null,
      providers: {
        mistral: { baseUrl: '', model: 'mistral-large-latest', apiKey: 'sk-clear-me-1234567890', enabled: true },
      },
    });
    await service.save({
      defaultProvider: null,
      providers: {
        mistral: { baseUrl: '', model: '', apiKey: '', enabled: false },
      },
    });
    const resolved = await service.resolve('mistral');
    expect(resolved.key).toBeNull();
  });

  it('clears defaultProvider when null is explicitly sent', async () => {
    const { service } = makeService();
    await service.save({ defaultProvider: 'gemini', providers: {} });
    await service.save({ defaultProvider: null, providers: {} });
    expect(await service.getDefaultProviderId()).toBeNull();
  });

  it('keeps the existing defaultProvider when the field is omitted', async () => {
    const { service } = makeService();
    await service.save({ defaultProvider: 'gemini', providers: {} });
    await service.save({ providers: {} });
    expect(await service.getDefaultProviderId()).toBe('gemini');
  });

  it('resolve returns null key when nothing is configured', async () => {
    const { service } = makeService();
    const resolved = await service.resolve('openrouter');
    expect(resolved.key).toBeNull();
    expect(resolved.config.model).toBe('');
  });

  it('getPublic reflects the saved default provider', async () => {
    const { service } = makeService();
    await service.save({ defaultProvider: 'openrouter', providers: {} });
    const pub: PublicAiSettings = await service.getPublic();
    expect(pub.defaultProvider).toBe('openrouter');
  });
});