import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Login } from './login.entity';

@Entity('risk_scores')
export class RiskScore {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'login_id', type: 'uuid', unique: true })
  loginId!: string;

  @OneToOne(() => Login, (login) => login.riskScore, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'login_id' })
  login!: Login;

  @Column({ name: 'rule_score', type: 'real' })
  ruleScore!: number;

  @Column({ name: 'ml_score', type: 'real', nullable: true })
  mlScore!: number | null;

  @Column({ name: 'total_score', type: 'real' })
  totalScore!: number;

  @Column()
  label!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
