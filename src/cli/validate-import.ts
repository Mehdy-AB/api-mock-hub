/**
 * Checks import files without touching any hub. Same rules as POST /_hub/api/import.
 *
 *   npm run validate-import -- mocks/orders.json [more.json ...]
 *
 * Exit code 0 when every file is valid, 1 otherwise.
 */
import { existsSync, readFileSync } from 'fs';
import { isPlainObject } from '../common/json-utils';
import { routeKey, routeLabel, sanitizeEndpoint } from '../endpoints/route-rules';
import { detectFormat, extractHubItems } from '../import/hub-format';
import { parseOpenApi } from '../import/openapi-parser';

const WRAPPER_KEYS = ['format', 'data', 'basePath', 'title', 'message', 'kind'];

export interface ValidationResult {
  format: string;
  routes: string[];
  errors: string[];
  warnings: string[];
}

export function validateImport(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const routes: string[] = [];
  let data = raw;
  let format: string | undefined;
  let basePath: string | undefined;

  // Import request body: { title, message, kind, format, basePath, data }
  if (isPlainObject(raw) && 'data' in raw && !('paths' in raw) && !('endpoints' in raw)) {
    data = raw.data;
    for (const k of Object.keys(raw)) if (!WRAPPER_KEYS.includes(k)) warnings.push(`unknown top-level key "${k}" is ignored`);
    if (raw.title !== undefined && (typeof raw.title !== 'string' || raw.title.length > 200)) {
      errors.push('title must be a string of at most 200 characters');
    }
    if (raw.message !== undefined && typeof raw.message !== 'string') errors.push('message must be a string');
    if (raw.kind !== undefined && raw.kind !== 'publish' && raw.kind !== 'request') {
      errors.push('kind must be "publish" or "request"');
    }
    if (raw.basePath !== undefined) {
      if (typeof raw.basePath !== 'string') errors.push('basePath must be a string');
      else basePath = raw.basePath;
    }
    if (raw.format !== undefined) {
      if (!['auto', 'hub', 'openapi'].includes(raw.format as string)) errors.push('format must be auto, hub or openapi');
      else if (raw.format !== 'auto') format = raw.format as string;
    }
  }
  const resolved = format ?? detectFormat(data);

  let items: unknown[];
  try {
    if (resolved === 'openapi') {
      const parsed = parseOpenApi(data, { basePath });
      items = parsed.endpoints;
      warnings.push(...parsed.warnings);
    } else {
      items = extractHubItems(data);
    }
  } catch (e) {
    errors.push(e.message);
    return { format: resolved, routes, errors, warnings };
  }
  if (!items.length) errors.push('no endpoints found');

  const seen = new Map<string, string>();
  items.forEach((item, i) => {
    const r = sanitizeEndpoint(item, `endpoints[${i}]`);
    if (!r.value) {
      errors.push(...r.errors);
      return;
    }
    const key = routeKey(r.value.method, r.value.path);
    const label = routeLabel(r.value);
    const clash = seen.get(key);
    if (clash) {
      errors.push(`endpoints[${i}]: ${label} collides with ${clash} (same method and path shape)`);
      return;
    }
    seen.set(key, label);
    const res = r.value.response;
    routes.push(`${label} -> ${res.status}${res.delayMs ? ` after ${res.delayMs} ms` : ''}`);
  });
  return { format: resolved, routes, errors, warnings };
}

function main(): void {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: npm run validate-import -- <file.json> [more.json ...]');
    process.exit(2);
  }
  let failed = 0;
  for (const file of files) {
    if (!existsSync(file)) {
      console.log(`FAIL ${file}: file not found`);
      failed++;
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      console.log(`FAIL ${file}: invalid JSON: ${e.message}`);
      failed++;
      continue;
    }
    const r = validateImport(raw);
    const ok = r.errors.length === 0;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${file}: ${r.format} format, ${r.routes.length} valid endpoint(s)`);
    for (const route of r.routes) console.log(`       ${route}`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
    for (const e of r.errors) console.log(`  error: ${e}`);
    if (!ok) failed++;
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
