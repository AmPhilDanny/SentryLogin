import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Login } from './login.entity';

@Entity('user_features')
export class UserFeature {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'login_id', type: 'uuid' })
  loginId!: string;

  @ManyToOne(() => Login, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'login_id' })
  login!: Login;

  @Column({ name: 'login_hour' })
  loginHour!: number;

  @Column({ name: 'day_of_week' })
  dayOfWeek!: number;

  @Column({ name: 'failed_attempts_in_window' })
  failedAttemptsInWindow!: number;

  @Column({ name: 'country_change' })
  countryChange!: boolean;

  @Column({ name: 'device_change' })
  deviceChange!: boolean;

  @Column({ name: 'browser_change' })
  browserChange!: boolean;

  @Column({ name: 'ip_change' })
  ipChange!: boolean;

  @Column({ name: 'geo_distance_km', type: 'real' })
  geoDistanceKm!: number;

  @Column({ name: 'account_login_frequency', type: 'real' })
  accountLoginFrequency!: number;

  @Column({ name: 'historical_success_rate', type: 'real' })
  historicalSuccessRate!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
