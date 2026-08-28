import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarBreakdown } from './BarBreakdown.js';

describe('BarBreakdown', () => {
  it('renders a labelled bar per row with the larger row wider', () => {
    render(
      <BarBreakdown
        rows={[
          { label: 'Alimentação', cents: 60_000 },
          { label: 'Lazer', cents: 10_000 },
        ]}
        emptyText="vazio"
      />,
    );
    expect(screen.getByText('Alimentação')).toBeInTheDocument();
    expect(screen.getByText('R$ 600,00')).toBeInTheDocument();

    const bigBar = screen.getByTestId('bar-Alimentação');
    const smallBar = screen.getByTestId('bar-Lazer');
    expect(parseFloat(bigBar.style.width)).toBeGreaterThan(parseFloat(smallBar.style.width));
  });

  it('renders the empty text when there are no rows', () => {
    render(<BarBreakdown rows={[]} emptyText="Nenhum dado." />);
    expect(screen.getByText('Nenhum dado.')).toBeInTheDocument();
  });
});
