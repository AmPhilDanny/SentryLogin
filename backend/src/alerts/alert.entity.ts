import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

const timestampColumnType =
  process.env.DATABASE_TYPE === 'postgres' ? 'timestamp' : 'datetime';

export type AlertStatus =
  | 'open'
  | 'dismissed'
  | 'escalated'
  | 'investigated'
  | 'resolved';

export type AlertResolution =
  | 'fraud'
  | 'positive'
  | 'false_positive'
  | 'no_action';

@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'login_id', type: 'uuid', unique: true })
  loginId!: string;

  @Column({ default: 'open' })
  status!: AlertStatus;

  @Column({ name: 'resolution', type: 'text', nullable: true })
  resolution!: AlertResolution | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy!: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'resolved_at', type: timestampColumnType, nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
