import fs from 'node:fs';
import path from 'node:path';

export function backupDatabase(dbPath: string, backupDir: string): string {
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `fumarende-${timestamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}
