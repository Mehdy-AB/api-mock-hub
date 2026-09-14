/**
 * Sets a user's password directly in the data folder. Use it when nobody can log in.
 *
 *   npm run reset-password -- <username> <new-password>
 *   npm run reset-password            (uses ADMIN_USER and ADMIN_PASSWORD from .env)
 *
 * Restart the hub afterwards: a running server keeps users in memory.
 */
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { loadConfig } from '../config/app-config';
import { loadDotEnv } from '../config/env-file';
import { readJson, writeJsonAtomic } from '../storage/json-file';
import type { User } from '../storage/models';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const [argUser, argPassword] = process.argv.slice(2);
  const username = (argUser ?? config.adminUser).trim();
  const password = argPassword ?? config.adminPassword;

  if (!password || password.length < 6) {
    throw new Error(
      'Give a password of at least 6 characters: npm run reset-password -- <username> <new-password>, or set ADMIN_PASSWORD in .env',
    );
  }

  const file = path.join(config.dataDir, 'users.json');
  const users = await readJson<User[]>(file, []);
  let user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());

  if (!user) {
    if (users.length && username !== config.adminUser) {
      throw new Error(`No user "${username}" in ${file}. Existing users: ${users.map((u) => u.username).join(', ')}`);
    }
    user = { id: randomUUID(), username, passwordHash: '', role: 'admin', createdAt: new Date().toISOString() };
    users.push(user);
    console.log(`Creating admin user "${username}".`);
  }

  user.passwordHash = bcrypt.hashSync(password, 10);
  user.disabled = false;
  await writeJsonAtomic(file, users);
  console.log(`Password for "${user.username}" (${user.role}) updated in ${file}.`);
  console.log('Restart the hub so it picks up the change.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
