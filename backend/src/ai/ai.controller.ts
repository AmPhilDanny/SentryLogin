import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { Roles } from '../auth/auth.guards';
import {
  AiSettingsService,
  PublicAiSettings,
  SaveProviderInput,
} from './ai-settings.service';
import { AiGatewayService, AiMessage } from './ai-gateway.service';
import { AiDescribeService } from './ai-describe.service';
import { AiProviderId, AI_PROVIDER_IDS } from './ai-settings.entity';

@Controller('ai')
export class AiController {
  constructor(
    private readonly settingsService: AiSettingsService,
    private readonly gateway: AiGatewayService,
    private readonly describeService: AiDescribeService,
  ) {}

  @Get('settings')
  getSettings(): Promise<PublicAiSettings> {
    return this.settingsService.getPublic();
  }

  @Put('settings')
  @Roles('manager', 'super_admin')
  updateSettings(
    @Body()
    body: {
      defaultProvider?: AiProviderId | null;
      providers?: Partial<Record<AiProviderId, SaveProviderInput>>;
    },
  ): Promise<PublicAiSettings> {
    return this.settingsService.save({
      defaultProvider: body.defaultProvider ?? null,
      providers: body.providers,
    });
  }

  @Post('test')
  @Roles('manager', 'super_admin')
  async testProvider(
    @Body()
    body: {
      provider: AiProviderId;
      baseUrl?: string;
      apiKey: string;
      model: string;
    },
  ) {
    if (!AI_PROVIDER_IDS.includes(body.provider)) {
      throw new BadRequestException('Unknown provider');
    }
    if (!body?.model?.trim()) {
      throw new BadRequestException('Model is required');
    }

    // A masked/empty key means "use the stored key" so Test works pre-save.
    const resolved = await this.settingsService.resolve(body.provider);
    const apiKey =
      body.apiKey && !body.apiKey.startsWith('••••') ? body.apiKey : resolved.key;
    if (!apiKey) {
      throw new BadRequestException(
        'API key is required — enter one or save a key first',
      );
    }

    return this.gateway.test({
      provider: body.provider,
      baseUrl: body.baseUrl || resolved.config.baseUrl,
      apiKey,
      model: body.model,
    });
  }

  @Post('complete')
  @Roles('manager', 'super_admin')
  async complete(
    @Body()
    body: {
      provider?: AiProviderId;
      model?: string;
      baseUrl?: string;
      messages: AiMessage[];
      temperature?: number;
      maxTokens?: number;
    },
  ) {
    if (!body.messages?.length) {
      throw new BadRequestException('messages is required');
    }

    const provider =
      body.provider ?? (await this.settingsService.getDefaultProviderId());
    if (!provider) {
      throw new BadRequestException(
        'No default provider configured. Pick a default provider in Settings.',
      );
    }

    const resolved = await this.settingsService.resolve(provider);
    if (!resolved.config.enabled) {
      throw new BadRequestException(
        `Provider "${provider}" is disabled in Settings. Enable it first.`,
      );
    }
    if (!resolved.key) {
      throw new BadRequestException(
        `Provider "${provider}" has no API key configured. Configure it in Settings.`,
      );
    }

    // Explicit override wins; otherwise use this provider's saved default model.
    // The user always controls which model is called — nothing is hardcoded.
    const model = body.model?.trim() || resolved.config.model;
    if (!model) {
      throw new BadRequestException(
        `No model configured for provider "${provider}". Set a model in Settings.`,
      );
    }

    const result = await this.gateway.completeRaw({
      provider,
      model,
      baseUrl: body.baseUrl || resolved.config.baseUrl,
      apiKey: resolved.key,
      messages: body.messages,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    });

    return { provider, model, content: result.text };
  }

  @Post('describe')
  @Roles('manager', 'super_admin')
  describe(
    @Body()
    body: { datasetId: string; prompt?: string },
  ) {
    if (!body?.datasetId) {
      throw new BadRequestException('datasetId is required');
    }
    return this.describeService.describe(body.datasetId, body.prompt);
  }
}