import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { nowIso } from '../common/util';
import { AuthUser, Role, User } from '../storage/models';
import { StoreService } from '../storage/store.service';

export type PublicUser = Omit<User, 'passwordHash'>;

export function publicUser(u: User): PublicUser {
  const { passwordHash: _hash, ...rest } = u;
  return rest;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly store: StoreService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  login(username: string, password: string) {
    const user = this.findByUsername(username);
    if (!user || user.disabled || !bcrypt.compareSync(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid username or password');
    }
    const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, this.store.jwtSecret, {
      expiresIn: this.config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    });
    return { token, expiresIn: this.config.jwtExpiresIn, user: publicUser(user) };
  }

  verify(token: string): AuthUser {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, this.store.jwtSecret) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token. Log in again.');
    }
    const user = this.store.db.users.find((u) => u.id === payload.sub);
    if (!user || user.disabled) throw new UnauthorizedException('User is no longer active');
    return { id: user.id, username: user.username, role: user.role };
  }

  listUsers(): PublicUser[] {
    return this.store.db.users.map(publicUser);
  }

  createUser(username: string, password: string, role: Role): Promise<PublicUser> {
    return this.store.write(['users'], (db) => {
      if (this.findByUsername(username)) throw new ConflictException(`User "${username}" already exists`);
      const user: User = {
        id: randomUUID(),
        username: username.trim(),
        passwordHash: bcrypt.hashSync(password, 10),
        role,
        createdAt: nowIso(),
      };
      db.users.push(user);
      return publicUser(user);
    });
  }

  updateUser(
    actor: AuthUser,
    id: string,
    patch: { role?: Role; password?: string; disabled?: boolean },
  ): Promise<PublicUser> {
    return this.store.write(['users'], (db) => {
      const user = db.users.find((u) => u.id === id);
      if (!user) throw new NotFoundException('User not found');
      const losesAdmin =
        user.role === 'admin' && !user.disabled && ((patch.role && patch.role !== 'admin') || patch.disabled === true);
      if (losesAdmin) {
        const activeAdmins = db.users.filter((u) => u.role === 'admin' && !u.disabled);
        if (activeAdmins.length <= 1) throw new BadRequestException('Cannot remove the last active admin');
      }
      if (patch.disabled === true && user.id === actor.id) throw new BadRequestException('You cannot disable yourself');
      if (patch.role) user.role = patch.role;
      if (patch.disabled !== undefined) user.disabled = patch.disabled;
      if (patch.password) user.passwordHash = bcrypt.hashSync(patch.password, 10);
      return publicUser(user);
    });
  }

  async changePassword(actor: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    await this.store.write(['users'], (db) => {
      const user = db.users.find((u) => u.id === actor.id);
      if (!user) throw new NotFoundException('User not found');
      if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
        throw new ForbiddenException('Current password is wrong');
      }
      user.passwordHash = bcrypt.hashSync(newPassword, 10);
    });
  }

  private findByUsername(username: string): User | undefined {
    const name = username.trim().toLowerCase();
    return this.store.db.users.find((u) => u.username.toLowerCase() === name);
  }
}
