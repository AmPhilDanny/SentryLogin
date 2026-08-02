import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Dataset } from './dataset.entity';
import { Login } from '../logins/login.entity';
import { RuleHit } from '../logins/rule-hit.entity';
import { RiskScore } from '../logins/risk-score.entity';
import { UserFeature } from '../logins/user-feature.entity';
import { AiExplanation } from '../explanations/ai-explanation.entity';
import { Alert } from '../alerts/alert.entity';

export interface DatasetPreview {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  total: number;
}

const CSV_COLUMNS = ['username', 'timestamp', 'ip', 'country', 'city', 'device', 'browser', 'success'];

@Injectable()
export class DatasetsService {
  constructor(
    @InjectRepository(Dataset) private readonly datasetRepo: Repository<Dataset>,
    @InjectRepository(Login) private readonly loginRepo: Repository<Login>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async create(filename: string, createdBy: string | null): Promise<Dataset> {
    const dataset = this.datasetRepo.create({
      filename,
      createdBy,
      rowCount: 0,
      importedCount: 0,
      flaggedCount: 0,
    });
    return this.datasetRepo.save(dataset);
  }

  async finalize(
    id: string,
    rowCount: number,
    importedCount: number,
    flaggedCount: number,
  ): Promise<void> {
    await this.datasetRepo.update(id, { rowCount, importedCount, flaggedCount });
  }

  async list() {
    const datasets = await this.datasetRepo.find({ order: { createdAt: 'DESC' } });
    return datasets.map((d) => ({
      id: d.id,
      filename: d.filename,
      rowCount: d.rowCount,
      importedCount: d.importedCount,
      flaggedCount: d.flaggedCount,
      createdAt: d.createdAt,
      createdBy: d.createdBy,
    }));
  }

  async getWithRows(id: string, limit = 50): Promise<DatasetPreview> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) throw new NotFoundException(`Dataset ${id} not found`);

    const total = await this.loginRepo.count({ where: { datasetId: id } });
    const logins = await this.loginRepo.find({
      where: { datasetId: id },
      relations: ['user'],
      take: Math.min(Math.max(limit, 1), 200),
      order: { timestamp: 'DESC' },
    });

    const rows = logins.map((l) => [
      l.user?.username ?? l.userId,
      l.timestamp.toISOString(),
      l.ip,
      l.country,
      l.city,
      l.device,
      l.browser,
      l.success,
    ]);

    return { columns: CSV_COLUMNS, rows, total };
  }

  async toCsv(id: string): Promise<{ filename: string; csv: string }> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) throw new NotFoundException(`Dataset ${id} not found`);

    const logins = await this.loginRepo.find({
      where: { datasetId: id },
      relations: ['user'],
      order: { timestamp: 'ASC' },
    });

    const escape = (value: unknown): string => {
      const s = String(value ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [CSV_COLUMNS.join(',')];
    for (const l of logins) {
      lines.push(
        [
          l.user?.username ?? l.userId,
          l.timestamp.toISOString(),
          l.ip,
          l.country,
          l.city,
          l.device,
          l.browser,
          l.success,
        ]
          .map(escape)
          .join(','),
      );
    }
    return { filename: dataset.filename, csv: lines.join('\n') };
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) throw new NotFoundException(`Dataset ${id} not found`);

    await this.dataSource.transaction(async (manager) => {
      const logins = await manager.find(Login, {
        where: { datasetId: id },
        select: ['id'],
      });
      const loginIds = logins.map((l) => l.id);
      if (loginIds.length > 0) {
        await manager.delete(RuleHit, { loginId: In(loginIds) });
        await manager.delete(RiskScore, { loginId: In(loginIds) });
        await manager.delete(UserFeature, { loginId: In(loginIds) });
        await manager.delete(AiExplanation, { loginId: In(loginIds) });
        await manager.delete(Alert, { loginId: In(loginIds) });
        await manager.delete(Login, { id: In(loginIds) });
      }
      await manager.delete(Dataset, { id });
    });

    return { deleted: true };
  }
}
