import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AuthUser, Role, ROLES } from './auth-user.entity';
import { JwtUser } from './auth.guards';

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
}

export interface LoginResult {
  accessToken: string;
  user: PublicUser;
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(AuthUser) private readonly authUserRepo: Repository<AuthUser>,
    private readonly jwtService: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedSuperAdmin();
  }

  private async seedSuperAdmin(): Promise<void> {
    const count = await this.authUserRepo.count();
    if (count === 0) {
      const admin = this.authUserRepo.create({
        email: 'admin@sentry.local',
        passwordHash: await bcrypt.hash('Admin@1234', 10),
        role: 'super_admin',
        displayName: 'Super Admin',
      });
      await this.authUserRepo.save(admin);
      console.log('[auth] seeded super admin: admin@sentry.local');
    }
  }

  async validateUser(email: string, password: string): Promise<AuthUser | null> {
    const user = await this.authUserRepo.findOne({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user) return null;
    const matches = await bcrypt.compare(password, user.passwordHash);
    return matches ? user : null;
  }

  async login(user: AuthUser): Promise<LoginResult> {
    const payload: JwtUser = {
      sub: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: this.toPublic(user),
    };
  }

  async listUsers(): Promise<PublicUser[]> {
    const users = await this.authUserRepo.find({ order: { createdAt: 'ASC' } });
    return users.map((u) => this.toPublic(u));
  }

  async createUser(dto: {
    email: string;
    password: string;
    role: string;
    displayName?: string;
  }): Promise<PublicUser> {
    const email = dto.email.toLowerCase().trim();
    if (!ROLES.includes(dto.role as Role)) {
      throw new BadRequestException(`role must be one of: ${ROLES.join(', ')}`);
    }
    const existing = await this.authUserRepo.findOne({ where: { email } });
    if (existing) throw new BadRequestException('A user with that email already exists');

    const user = this.authUserRepo.create({
      email,
      passwordHash: await bcrypt.hash(dto.password, 10),
      role: dto.role as Role,
      displayName: dto.displayName ?? null,
    });
    return this.toPublic(await this.authUserRepo.save(user));
  }

  async deleteUser(id: string, currentUserId: string): Promise<{ deleted: boolean }> {
    const target = await this.authUserRepo.findOne({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === currentUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    if (target.role === 'super_admin') {
      const superAdmins = await this.authUserRepo.count({ where: { role: 'super_admin' } });
      if (superAdmins <= 1) {
        throw new BadRequestException('You cannot delete the last super admin');
      }
    }
    await this.authUserRepo.delete(id);
    return { deleted: true };
  }

  private toPublic(user: AuthUser): PublicUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
    };
  }
}
