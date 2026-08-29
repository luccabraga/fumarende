import fs from 'node:fs';

/**
 * Minimal .env loader: `KEY=VALUE` per line, `#` comments and blank
 * lines ignored, optional surrounding single/double quotes stripped,
 * surrounding whitespace trimmed. Never overrides a key already present
 * in `process.env`. A missing file is a silent no-op.
 */
export function loadDotEnv(filePath: string): void {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === '' || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
