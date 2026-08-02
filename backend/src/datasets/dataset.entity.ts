import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DatasetStatus = 'uploaded' | 'analyzing' | 'complete' | 'failed';

@Entity('datasets')
export class Dataset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  filename!: string;

  @Column({ name: 'row_count', type: 'int', default: 0 })
  rowCount!: number;

  @Column({ name: 'imported_count', type: 'int', default: 0 })
  importedCount!: number;

  @Column({ name: 'flagged_count', type: 'int', default: 0 })
  flaggedCount!: number;

  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy!: string | null;

  /** uploaded → analyzing → complete | failed */
  @Column({ type: 'varchar', default: 'uploaded' })
  status!: DatasetStatus;

  /** Human-readable current pipeline stage while analyzing. */
  @Column({ type: 'varchar', nullable: true })
  stage!: string | null;

  /** 0-100 progress while analyzing. */
  @Column({ type: 'int', default: 0 })
  progress!: number;

  /** Error message when status === 'failed'. */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  /** JSON-serialized DetectionResult from upload time. */
  @Column({ type: 'text', nullable: true })
  detection!: string | null;

  /** Raw uploaded CSV content (kept for "view head" + re-analysis). */
  @Column({ name: 'raw_csv', type: 'text', nullable: true })
  rawCsv!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
