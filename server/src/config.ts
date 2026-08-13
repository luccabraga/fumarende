import os from 'node:os';
import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  frontendDistDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir =
    env.FUMARENDE_DATA_DIR ??
    path.join(os.homedir(), 'Library', 'Application Support', 'fumarende');

  return {
    port: Number(env.FUMARENDE_PORT ?? 4173),
    dataDir,
    dbPath: path.join(dataDir, 'fumarende.db'),
    backupDir: path.join(dataDir, 'backups'),
    frontendDistDir:
      env.FUMARENDE_FRONTEND_DIST ??
      path.join(process.cwd(), '..', 'frontend', 'dist'),
  };
}
