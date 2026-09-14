import * as path from 'path';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  /** When empty a secret is generated once and kept in DATA_DIR/.jwt-secret. */
  jwtSecret?: string;
  jwtExpiresIn: string;
  adminUser: string;
  /** When empty a random password is generated and printed once on first boot. */
  adminPassword?: string;
  /** When set, mock routes require the header x-mock-key with this value. */
  mockApiKey?: string;
  bodyLimit: string;
  /** Built web UI (client/dist). Served at /_hub/ when present. */
  uiDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  return {
    host: env.HOST || '0.0.0.0',
    port,
    dataDir: path.resolve(env.DATA_DIR || 'data'),
    jwtSecret: env.JWT_SECRET || undefined,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
    adminUser: env.ADMIN_USER || 'admin',
    adminPassword: env.ADMIN_PASSWORD || undefined,
    mockApiKey: env.MOCK_API_KEY || undefined,
    bodyLimit: env.BODY_LIMIT || '5mb',
    // dist/config -> <root>/client/dist, and src/config -> <root>/client/dist under ts-node/jest
    uiDir: path.resolve(env.UI_DIR || path.join(__dirname, '..', '..', 'client', 'dist')),
  };
}
