import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type Role = 'analyst' | 'manager' | 'super_admin';

export const ROLES: Role[] = ['analyst', 'manager', 'super_admin'];

@Entity('auth_users')
export class AuthUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column({ default: 'analyst' })
  role!: Role;

  @Column({ name: 'display_name', type: 'varchar', nullable: true })
  displayName!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
