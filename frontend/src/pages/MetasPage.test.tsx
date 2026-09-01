import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '../test-utils.js';
import { MetasPage } from './MetasPage.js';
import * as api from '../lib/api.js';

describe('MetasPage', () => {
  it('renders the heading and lists goals', async () => {
    const listSpy = vi.spyOn(api.goalsApi, 'list').mockResolvedValue([]);
    render(<MetasPage />);
    expect(screen.getByRole('heading', { name: 'Metas' })).toBeInTheDocument();
    await waitFor(() => expect(listSpy).toHaveBeenCalled());
  });
});
