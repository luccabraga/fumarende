import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest.config.ts does not enable `test.globals`, so @testing-library/react's
// built-in auto-cleanup (which only registers if `afterEach` exists on the
// global scope) never fires. Without this, DOM from one test leaks into the
// next, causing "multiple elements found" failures. See official
// testing-library guidance for non-globals Vitest setups.
afterEach(() => {
  cleanup();
});
