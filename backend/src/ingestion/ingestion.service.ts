import { Injectable } from '@nestjs/common';
import { DatasetsService, UploadResult } from '../datasets/datasets.service';

@Injectable()
export class IngestionService {
  constructor(private readonly datasetsService: DatasetsService) {}

  /**
   * Stage 1 of the two-stage flow: store the uploaded CSV and run smart
   * detection (format, column mapping, feedback). No analysis is performed —
   * the caller triggers it via POST /api/datasets/:id/analyze.
   */
  async uploadCsv(
    buffer: Buffer,
    filename: string,
    createdBy: string | null,
  ): Promise<UploadResult> {
    return this.datasetsService.createFromUpload(filename, createdBy, buffer);
  }
}
