import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AsyncBoundary } from './AsyncBoundary.js';

describe('AsyncBoundary', () => {
  it('shows a skeleton while loading, not the children', () => {
    const { container } = render(
      <AsyncBoundary loading error={null} onRetry={() => {}}>
        <p>conteúdo</p>
      </AsyncBoundary>,
    );
    expect(container.querySelector('.skeleton')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
  });

  it('shows the error message + a working Recarregar', () => {
    const onRetry = vi.fn();
    render(
      <AsyncBoundary loading={false} error="rede caiu" onRetry={onRetry}>
        <p>conteúdo</p>
      </AsyncBoundary>,
    );
    expect(screen.getByText('rede caiu')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders children when resolved', () => {
    render(
      <AsyncBoundary loading={false} error={null} onRetry={() => {}}>
        <p>conteúdo</p>
      </AsyncBoundary>,
    );
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });
});
