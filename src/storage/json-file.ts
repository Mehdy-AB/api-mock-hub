import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Data file ${file} is not valid JSON: ${e.message}`);
  }
}

/** Write to a temp file then rename, so a crash never leaves a half-written data file. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (e) {
      // Windows can briefly lock files (antivirus, editors). Retry a few times.
      const retryable = ['EPERM', 'EBUSY', 'EACCES'].includes(e.code);
      if (!retryable || attempt >= 5) {
        await fs.rm(tmp, { force: true });
        throw e;
      }
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
}
