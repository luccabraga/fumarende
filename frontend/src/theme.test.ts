import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// strip comments so selector text can't hide in them
const css = fs
  .readFileSync(path.join(__dirname, 'theme.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function bodyOfBlock(selector: string): string {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{');
  const m = re.exec(css);
  if (!m) throw new Error(`selector not found: ${selector}`);
  const open = m.index + m[0].length - 1;
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function propsInBlock(selector: string): Set<string> {
  const body = bodyOfBlock(selector);
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1]));
}

function tokenHex(body: string, name: string): string {
  const m = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`).exec(body);
  if (!m) throw new Error(`token not found: ${name}`);
  return m[1];
}

function relLum(hex: string): number {
  const c = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(c.substr(i, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('theme.css', () => {
  it('keeps the alias custom properties on :root', () => {
    const rootBody = css.slice(css.indexOf(':root {'), css.indexOf('}'));
    for (const alias of [
      '--card',
      '--bg2',
      '--text2',
      '--text3',
      '--cyan',
      '--coral',
      '--amber',
      '--sans',
      '--mono',
      '--radius',
    ]) {
      expect(rootBody).toContain(alias);
    }
  });

  it('the two dark blocks declare the same custom-property names', () => {
    const explicit = propsInBlock("[data-theme='dark']");
    const media = propsInBlock(":root:not([data-theme='light'])");
    expect([...explicit].sort()).toEqual([...media].sort());
    expect(explicit.size).toBeGreaterThan(8);
  });

  it('defines the class vocabulary', () => {
    for (const cls of [
      '.btn',
      '.btn-primary',
      '.btn-ghost',
      '.field-label',
      '.page-title',
      '.section-title',
      '.stack',
      '.row',
      '.table-scroll',
      '.nav',
      '.page',
      '.page-header',
      '.form-grid',
      '.list-row',
      '.data-list',
      '.data-table',
      '.chart-svg',
      '.skip-link',
      '.sr-only',
      '.link-btn',
    ]) {
      expect(css).toContain(cls);
    }
  });
});

describe('theme.css contrast (WCAG AA)', () => {
  const light = bodyOfBlock(':root');
  const dark = bodyOfBlock("[data-theme='dark']");

  it('light foreground tokens clear 4.5:1 on card (#fff) and page bg (#f7f6f3)', () => {
    for (const name of ['--accent', '--danger', '--warning', '--text-subtle', '--success']) {
      const hex = tokenHex(light, name);
      expect(contrast(hex, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex, '#f7f6f3')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark text tokens clear 4.5:1 on the dark card (#101016)', () => {
    for (const name of ['--text-subtle', '--text-muted']) {
      const hex = tokenHex(dark, name);
      expect(contrast(hex, '#101016')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
