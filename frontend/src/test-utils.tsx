import type { ReactElement, ReactNode } from 'react';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { ToastProvider } from './context/ToastContext.js';

function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

/**
 * Drop-in replacement for @testing-library/react's `render` that wraps the
 * tree in the app-wide context providers (ToastProvider). Page components
 * call `useToast()`, which throws without a provider.
 */
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: Providers, ...options });
}

export * from '@testing-library/react';
