import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader.js';

describe('PageHeader', () => {
  it('renders the title as an h1', () => {
    render(<PageHeader title="Receitas" />);
    expect(screen.getByRole('heading', { name: 'Receitas' }).tagName).toBe('H1');
  });

  it('renders the subtitle only when given', () => {
    const { rerender, container } = render(<PageHeader title="X" />);
    expect(container.querySelector('.page-header__subtitle')).toBeNull();
    rerender(<PageHeader title="X" subtitle="uma explicação" />);
    expect(screen.getByText('uma explicação')).toBeInTheDocument();
  });

  it('renders an actions node when given', () => {
    render(<PageHeader title="X" actions={<button>Nova</button>} />);
    expect(screen.getByRole('button', { name: 'Nova' })).toBeInTheDocument();
  });
});
