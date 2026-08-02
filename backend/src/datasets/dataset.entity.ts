import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
