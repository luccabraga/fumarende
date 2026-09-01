import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastContext.js';

function Trigger() {
  const { toast } = useToast();
  return (
    <div>
      <button onClick={() => toast('success', 'salvo')}>ok</button>
      <button onClick={() => toast('error', 'falhou')}>err</button>
    </div>
  );
}

afterEach(() => vi.useRealTimers());

describe('ToastContext', () => {
  it('shows a toast in a live region and stacks a second', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('err'));
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('salvo');
    expect(region).toHaveTextContent('falhou');
  });

  it('a toast can be dismissed and auto-dismisses after 3.5s', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('ok').click();
    });
    expect(screen.getByText('salvo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByText('salvo')).not.toBeInTheDocument();

    act(() => {
      screen.getByText('err').click();
    });
    expect(screen.getByText('falhou')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3600);
    });
    expect(screen.queryByText('falhou')).not.toBeInTheDocument();
  });

  it('useToast throws outside a provider', () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ToastProvider/);
  });
});
