import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('shows the message, and the action only when given', () => {
    const { rerender } = render(<EmptyState message="Nada aqui." />);
    expect(screen.getByText('Nada aqui.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<EmptyState message="Nada aqui." action={<button>Criar</button>} />);
    expect(screen.getByRole('button', { name: 'Criar' })).toBeInTheDocument();
  });
});
