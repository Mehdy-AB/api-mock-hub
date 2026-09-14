/**
 * Loads KEY=value pairs from .env in the current directory, if the file exists.
 * Variables already set in the real environment win, so Docker and CI settings are never overridden.
 */
export function loadDotEnv(file = '.env'): void {
  try {
    process.loadEnvFile(file);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`Could not read ${file}: ${e.message}`);
  }
}
