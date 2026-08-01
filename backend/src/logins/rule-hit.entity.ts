import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Login } from './login.entity';

@Entity('rule_hits')
export class RuleHit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'login_id', type: 'uuid' })
  loginId!: string;

  @ManyToOne(() => Login, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'login_id' })
  login!: Login;

  @Column({ name: 'rule_name' })
  ruleName!: string;

  @Column()
  triggered!: boolean;

  @Column({ type: 'text', nullable: true })
  details!: string | null;

  @Column({ type: 'real' })
  score!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
