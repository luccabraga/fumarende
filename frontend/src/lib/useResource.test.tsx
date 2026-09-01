import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useResource } from './useResource.js';

function Probe({ loader, dep }: { loader: () => Promise<string>; dep?: number }) {
  const r = useResource(loader, [dep]);
  return (
    <div>
      <span data-testid="loading">{String(r.loading)}</span>
      <span data-testid="data">{r.data ?? ''}</span>
      <span data-testid="error">{r.error ?? ''}</span>
      <button onClick={r.reload}>reload</button>
    </div>
  );
}

describe('useResource', () => {
  it('goes loading -> resolved', async () => {
    const loader = vi.fn().mockResolvedValue('hello');
    render(<Probe loader={loader} />);
    expect(screen.getByTestId('loading').textContent).toBe('true');
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('hello'));
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('surfaces a rejection as an error message', async () => {
    render(<Probe loader={() => Promise.reject(new Error('boom'))} />);
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('boom'));
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('reload() re-runs the loader', async () => {
    const loader = vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');
    render(<Probe loader={loader} />);
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('a'));
    fireEvent.click(screen.getByText('reload'));
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('b'));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not set state after unmount', async () => {
    let resolve: (v: string) => void = () => {};
    const loader = () => new Promise<string>((r) => (resolve = r));
    const { unmount } = render(<Probe loader={loader} />);
    unmount();
    resolve('late');
    await new Promise((r) => setTimeout(r, 0));
  });
});
