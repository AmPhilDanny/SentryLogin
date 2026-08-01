import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../logins/user.entity';
import { Login } from '../logins/login.entity';

export interface UserProfile {
  userId: string;
  username: string;
  totalLogins: number;
  typicalHour: number | null;
  typicalCountry: string | null;
  typicalDevice: string | null;
  typicalBrowser: string | null;
  avgLoginsPerDay: number | null;
  successRate: number | null;
  daysSpan: number;
}

function mode(values: (string | number)[]): string | number | null {
  if (values.length === 0) return null;
  const counts = new Map<string | number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | number | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Computes a user's behavioral baseline (typical hours, country, device,
 * browser, login frequency) from their login history (S4.1).
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Login) private readonly loginRepo: Repository<Login>,
  ) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const logins = await this.loginRepo
      .createQueryBuilder('login')
      .leftJoinAndSelect('login.features', 'features')
      .where('login.userId = :userId', { userId })
      .orderBy('login.timestamp', 'ASC')
      .getMany();

    if (logins.length === 0) {
      return {
        userId,
        username: user.username,
        totalLogins: 0,
        typicalHour: null,
        typicalCountry: null,
        typicalDevice: null,
        typicalBrowser: null,
        avgLoginsPerDay: null,
        successRate: null,
        daysSpan: 0,
      };
    }

    const hours = logins.map(
      (l) => l.features?.[0]?.loginHour ?? l.timestamp.getHours(),
    );
    const countries = logins.map((l) => l.country);
    const devices = logins.map((l) => l.device);
    const browsers = logins.map((l) => l.browser);
    const successes = logins.filter((l) => l.success).length;

    const first = logins[0].timestamp.getTime();
    const last = logins[logins.length - 1].timestamp.getTime();
    const daysSpan = Math.max(1, (last - first) / 86_400_000);

    return {
      userId,
      username: user.username,
      totalLogins: logins.length,
      typicalHour: (mode(hours) as number | null) ?? null,
      typicalCountry: (mode(countries) as string | null) ?? null,
      typicalDevice: (mode(devices) as string | null) ?? null,
      typicalBrowser: (mode(browsers) as string | null) ?? null,
      avgLoginsPerDay: Math.round((logins.length / daysSpan) * 100) / 100,
      successRate: Math.round((successes / logins.length) * 1000) / 1000,
      daysSpan: Math.round(daysSpan * 10) / 10,
    };
  }
}
