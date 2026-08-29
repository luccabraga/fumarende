import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from './markdown.js';

describe('Markdown', () => {
  it('renders headings, paragraphs, bold, and lists', () => {
    render(
      <Markdown
        source={'# Título\n\nUm **forte** e um *ênfase*.\n\n- a\n- b\n\n1. um\n2. dois'}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Título' })).toBeInTheDocument();
    expect(screen.getByText('forte').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'a',
      'b',
      'um',
      'dois',
    ]);
  });

  it('renders inline code and does not inject HTML', () => {
    render(<Markdown source={'Use `x` aqui. <script>alert(1)</script>'} />);
    expect(screen.getByText('x').tagName).toBe('CODE');
    expect(screen.queryByText('alert(1)')).not.toBeInTheDocument();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
  });
});
