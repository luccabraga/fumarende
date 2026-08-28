import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProjetosPage } from './ProjetosPage.js';
import * as api from '../lib/api.js';

describe('ProjetosPage', () => {
  it('renders the heading and lists projects', async () => {
    const listSpy = vi.spyOn(api.projectsApi, 'list').mockResolvedValue([]);
    render(<ProjetosPage />);
    expect(screen.getByRole('heading', { name: 'Projetos Especiais' })).toBeInTheDocument();
    await waitFor(() => expect(listSpy).toHaveBeenCalled());
  });
});
