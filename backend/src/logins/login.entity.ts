import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { RiskScore } from './risk-score.entity';
import { RuleHit } from './rule-hit.entity';
import { UserFeature } from './user-feature.entity';

@Entity('logins')
export class Login {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToOne(() => RiskScore, (rs) => rs.login)
  riskScore!: RiskScore;

  @OneToMany(() => RuleHit, (rh) => rh.login)
  ruleHits!: RuleHit[];

  @OneToMany(() => UserFeature, (uf) => uf.login)
  features!: UserFeature[];

  @Column({ type: 'datetime' })
  timestamp!: Date;

  @Column()
  ip!: string;

  @Column()
  country!: string;

  @Column()
  city!: string;

  @Column()
  device!: string;

  @Column()
  browser!: string;

  @Column()
  success!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
