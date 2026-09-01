import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs
  .readFileSync(path.join(__dirname, 'theme.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments so selector text can't hide in them

function propsInBlock(selector: string): Set<string> {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{');
  const m = re.exec(css);
  if (!m) throw new Error(`selector not found: ${selector}`);
  const open = m.index + m[0].length - 1;
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1]));
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
    ]) {
      expect(css).toContain(cls);
    }
  });
});
