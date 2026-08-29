import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom in this setup does not ship a Storage implementation, so provide a
// minimal in-memory localStorage for code (and tests) that touch it.
if (typeof globalThis.localStorage === 'undefined') {
  class MemoryStorage {
    private store = new Map<string, string>();
    get length() {
      return this.store.size;
    }
    clear() {
      this.store.clear();
    }
    getItem(key: string) {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string) {
      this.store.set(key, String(value));
    }
    removeItem(key: string) {
      this.store.delete(key);
    }
    key(index: number) {
      return [...this.store.keys()][index] ?? null;
    }
  }
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  }
}

// vitest.config.ts does not enable `test.globals`, so @testing-library/react's
// built-in auto-cleanup (which only registers if `afterEach` exists on the
// global scope) never fires. Without this, DOM from one test leaks into the
// next, causing "multiple elements found" failures. See official
// testing-library guidance for non-globals Vitest setups.
afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});
