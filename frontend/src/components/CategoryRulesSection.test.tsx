import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CategoryRulesSection } from './CategoryRulesSection.js';
import * as api from '../lib/api.js';

beforeEach(() => {
  vi.spyOn(api, 'listCategoryRules').mockResolvedValue([
    { id: 1, keyword: 'uber', category: 'Transporte' },
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe('CategoryRulesSection', () => {
  it('lists rules and deletes one', async () => {
    const del = vi.spyOn(api, 'deleteCategoryRule').mockResolvedValue({ ok: true });
    render(<CategoryRulesSection />);
    expect(await screen.findByText(/uber/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir regra uber' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(1));
  });

  it('adds a rule via the form', async () => {
    const add = vi
      .spyOn(api, 'createCategoryRule')
      .mockResolvedValue({ id: 2, keyword: 'ifood', category: 'Delivery' });
    render(<CategoryRulesSection />);
    await screen.findByText(/uber/);

    fireEvent.change(screen.getByLabelText('Palavra-chave'), { target: { value: 'iFood' } });
    fireEvent.change(screen.getByLabelText('Categoria da regra'), { target: { value: 'Delivery' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar regra' }));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({ keyword: 'iFood', category: 'Delivery' }),
    );
  });

  it('shows an error when the add call 400s', async () => {
    vi.spyOn(api, 'createCategoryRule').mockRejectedValue(new Error('keyword is required'));
    render(<CategoryRulesSection />);
    await screen.findByText(/uber/);
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar regra' }));
    expect(await screen.findByText(/keyword is required/)).toBeInTheDocument();
  });
});
