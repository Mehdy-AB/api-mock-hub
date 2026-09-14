import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Mutex } from '../common/mutex';
import { readJson, writeJsonAtomic } from './json-file';
import { Commit, Db, DEFAULT_SETTINGS, Endpoint, Proposal, Settings, User } from './models';

export type CollectionName = keyof Db;
export const ALL_COLLECTIONS: CollectionName[] = ['endpoints', 'proposals', 'commits', 'users', 'settings'];

/**
 * In-memory database persisted as one JSON file per collection.
 * All writes go through `write()`, which is serialised, rolls back on error and saves atomically.
 */
@Injectable()
export class StoreService implements OnModuleInit {
  private readonly logger = new Logger('Store');
  private readonly mutex = new Mutex();
  private data: Db;
  private loaded = false;
  private revision = 0;
  private secret: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    await this.load();
  }

  /** Read-only view of the current data. Mutate only inside `write()`. */
  get db(): Readonly<Db> {
    this.assertLoaded();
    return this.data;
  }

  /** Increments whenever the endpoint set changes. Used by caches. */
  get endpointsRevision(): number {
    return this.revision;
  }

  get jwtSecret(): string {
    this.assertLoaded();
    return this.secret;
  }

  get lastCommitId(): number {
    const commits = this.db.commits;
    return commits.length ? commits[commits.length - 1].id : 0;
  }

  write<T>(names: CollectionName[], fn: (db: Db) => T): Promise<T> {
    return this.mutex.runExclusive(async () => {
      this.assertLoaded();
      const backup = new Map(names.map((n) => [n, structuredClone(this.data[n])]));
      const restore = () => {
        for (const [n, v] of backup) (this.data as unknown as Record<string, unknown>)[n] = v;
        if (names.includes('endpoints')) this.revision++;
      };
      let result: T;
      try {
        result = fn(this.data);
      } catch (e) {
        restore();
        throw e;
      }
      try {
        await Promise.all(names.map((n) => writeJsonAtomic(this.file(n), this.data[n])));
      } catch (e) {
        this.logger.error(`Saving ${names.join(', ')} failed: ${e.message}`);
        restore();
        throw e;
      }
      if (names.includes('endpoints')) this.revision++;
      return result;
    });
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const dir = this.config.dataDir;
    await fs.mkdir(dir, { recursive: true });
    const [endpoints, proposals, commits, users, settings] = await Promise.all([
      readJson<Endpoint[]>(this.file('endpoints'), []),
      readJson<Proposal[]>(this.file('proposals'), []),
      readJson<Commit[]>(this.file('commits'), []),
      readJson<User[]>(this.file('users'), []),
      readJson<Partial<Settings>>(this.file('settings'), {}),
    ]);
    this.data = {
      endpoints,
      proposals,
      commits,
      users,
      settings: {
        ...DEFAULT_SETTINGS,
        ...settings,
        requiredApproverRole: { ...DEFAULT_SETTINGS.requiredApproverRole, ...(settings.requiredApproverRole ?? {}) },
      },
    };
    this.secret = this.config.jwtSecret ?? (await this.loadOrCreateSecret());
    this.revision++;
    this.loaded = true;
    if (users.length === 0) {
      await this.seedAdmin();
    } else if (this.config.adminPassword) {
      const admin = users.find((u) => u.username.toLowerCase() === this.config.adminUser.toLowerCase());
      if (admin && !bcrypt.compareSync(this.config.adminPassword, admin.passwordHash)) {
        this.logger.warn(
          `ADMIN_PASSWORD does not match user "${admin.username}" and is ignored, because users already exist. ` +
            'To apply it, run: npm run reset-password',
        );
      }
    }
    this.logger.log(
      `Loaded ${endpoints.length} endpoints, ${proposals.length} proposals, ${commits.length} commits from ${dir}`,
    );
  }

  private async seedAdmin(): Promise<void> {
    const password = this.config.adminPassword ?? randomBytes(9).toString('base64url');
    await this.write(['users'], (db) => {
      db.users.push({
        id: randomUUID(),
        username: this.config.adminUser,
        passwordHash: bcrypt.hashSync(password, 10),
        role: 'admin',
        createdAt: new Date().toISOString(),
      });
    });
    if (this.config.adminPassword) {
      this.logger.log(`Created admin user "${this.config.adminUser}" from ADMIN_PASSWORD`);
    } else {
      this.logger.warn(
        `Created admin user "${this.config.adminUser}" with generated password: ${password}  (shown once; change it after login)`,
      );
    }
  }

  private async loadOrCreateSecret(): Promise<string> {
    const file = path.join(this.config.dataDir, '.jwt-secret');
    try {
      const s = (await fs.readFile(file, 'utf8')).trim();
      if (s) return s;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const s = randomBytes(48).toString('hex');
    await fs.writeFile(file, s, { encoding: 'utf8', mode: 0o600 });
    return s;
  }

  private file(name: CollectionName): string {
    return path.join(this.config.dataDir, `${name}.json`);
  }

  private assertLoaded(): void {
    if (!this.loaded) throw new Error('Store is not loaded yet');
  }
}
