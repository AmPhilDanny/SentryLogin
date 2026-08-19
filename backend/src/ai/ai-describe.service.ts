import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { Dataset } from '../datasets/dataset.entity';
import { AiSettingsService } from './ai-settings.service';
import { AiGatewayService } from './ai-gateway.service';
import { AiProviderId } from './ai-settings.entity';

/**
 * Privacy boundary: real records never leave the platform. Reads stored head
 * rows, masks PII-shaped cells, and sends only columns + masked sample +
 * derived counts to the configured provider.
 */
@Injectable()
export class AiDescribeService {
  private readonly MAX_ROWS = 10;

  constructor(
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
    private readonly settingsService: AiSettingsService,
    private readonly gateway: AiGatewayService,
  ) {}

  async describe(datasetId: string, userPrompt?: string): Promise<{ content: string; provider: AiProviderId; model: string }> {
    const dataset = await this.datasetRepo.findOne({ where: { id: datasetId } });
    if (!dataset) throw new NotFoundException(`Dataset ${datasetId} not found`);

    const provider =
      (await this.settingsService.getDefaultProviderId()) as AiProviderId | null;
    if (!provider) {
      throw new BadRequestException(
        'No default AI provider configured. Go to AI Settings and pick one.',
      );
    }
    const resolved = await this.settingsService.resolve(provider);
    if (!resolved.key) {
      throw new BadRequestException(
        `Provider "${provider}" is not configured. Set its API key in AI Settings.`,
      );
    }
    if (!resolved.config.model) {
      throw new BadRequestException(
        `No model set for provider "${provider}". Set one in AI Settings.`,
      );
    }

    const columns: string[] = [];
    const rows: string[][] = [];

    const raw = (dataset.rawCsv ?? '').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      const parsed = parse(lines.slice(0, this.MAX_ROWS + 1).join('\n'), {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
      }) as string[][];
      if (parsed.length > 0) {
        columns.push(...(parsed[0] ?? []));
        rows.push(...parsed.slice(1).map((r) => r.map((c) => this.mask(c))));
      }
    }

    const synthesized = {
      filename: dataset.filename,
      columns,
      totalRows: dataset.rowCount || lines.length,
      sampleRows: rows.slice(0, this.MAX_ROWS),
      note: 'Values shown are MASKED placeholders. Real data never leaves the platform.',
    };

    const userMsg = userPrompt?.trim()
      ? `${userPrompt.trim()}\n\nDataset context:\n${JSON.stringify(synthesized, null, 2)}`
      : `Describe this uploaded dataset in plain language: what kind of data it contains, what each column likely means, any data-quality concerns, and how it could relate to login-fraud detection.\n\nDataset context:\n${JSON.stringify(synthesized, null, 2)}`;

    const result = await this.gateway.completeRaw({
      provider,
      model: resolved.config.model,
      baseUrl: resolved.config.baseUrl,
      apiKey: resolved.key,
      messages: [
        {
          role: 'system',
          content:
            'You are a data analyst for a SOC login-fraud platform. Only ever discuss the masked/synthesized data provided. Never claim to see real records.',
        },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    });

    return { content: result.text, provider, model: resolved.config.model };
  }

  private mask(value: string): string {
    const v = String(value ?? '');
    if (v === '') return '';
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return '[email]';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return '[ip]';
    if (/^[0-9a-fA-F]{8}[-:][0-9a-fA-F]{4}[-:][0-9a-fA-F]{4}/.test(v))
      return '[mac]';
    if (/^[A-Za-z0-9_-]{24,}$/.test(v)) return '[id:hash]';
    return v;
  }
}