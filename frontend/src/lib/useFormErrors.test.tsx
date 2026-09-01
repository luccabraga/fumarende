import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFormErrors } from './useFormErrors.js';

function Probe() {
  const f = useFormErrors();
  return (
    <div>
      <span data-testid="amount">{f.errors.amount ?? ''}</span>
      <span data-testid="has">{String(f.hasErrors)}</span>
      <button onClick={() => f.setError('amount', 'bad')}>set</button>
      <button onClick={() => f.clearError('amount')}>clear</button>
      <button onClick={() => f.clearAll()}>clearAll</button>
    </div>
  );
}

describe('useFormErrors', () => {
  it('set / clear / clearAll and hasErrors', () => {
    render(<Probe />);
    expect(screen.getByTestId('has').textContent).toBe('false');
    fireEvent.click(screen.getByText('set'));
    expect(screen.getByTestId('amount').textContent).toBe('bad');
    expect(screen.getByTestId('has').textContent).toBe('true');
    fireEvent.click(screen.getByText('clear'));
    expect(screen.getByTestId('has').textContent).toBe('false');
    fireEvent.click(screen.getByText('set'));
    fireEvent.click(screen.getByText('clearAll'));
    expect(screen.getByTestId('has').textContent).toBe('false');
  });
});
