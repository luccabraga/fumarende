import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from './Skeleton.js';

describe('Skeleton', () => {
  it('renders the requested number of blocks and is hidden from a11y', () => {
    const { container } = render(<Skeleton rows={4} />);
    const root = container.querySelector('.skeleton')!;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelectorAll('.skeleton__block')).toHaveLength(4);
  });
});
