import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TargetSection } from './TargetSection.js';
import type { TargetsClient, Target } from '../lib/api.js';

function fakeClient(items: Target[]): TargetsClient {
  return {
    list: vi.fn().mockResolvedValue(items),
    create: vi.fn().mockResolvedValue({ id: 99 }),
    update: vi.fn().mockResolvedValue({ ok: true }),
    addTo: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
  };
}

const sample: Target = {
  id: 1,
  name: 'PS5',
  targetCents: 400_000,
  currentCents: 100_000,
  targetDate: null,
  notes: null,
  status: 'active',
};

describe('TargetSection', () => {
  it('lists items from api.list', async () => {
    render(
      <TargetSection api={fakeClient([sample])} showNotes={false} heading="H" emptyText="none" />,
    );
    expect(await screen.findByText('PS5')).toBeInTheDocument();
  });

  it('shows the empty text when there are none', async () => {
    render(<TargetSection api={fakeClient([])} showNotes={false} heading="H" emptyText="none yet" />);
    expect(await screen.findByText('none yet')).toBeInTheDocument();
  });

  it('creates with parsed cents, including currentCents when filled', async () => {
    const client = fakeClient([]);
    render(<TargetSection api={client} showNotes={false} heading="H" emptyText="x" />);
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Viagem' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Valor já guardado (R$)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Viagem', targetCents: 500_000, currentCents: 100_000 }),
      ),
    );
  });

  it('renders the motivação field only when showNotes is true', async () => {
    const { rerender } = render(
      <TargetSection api={fakeClient([])} showNotes={false} heading="H" emptyText="x" />,
    );
    await waitFor(() => {});
    expect(screen.queryByLabelText('Motivação')).not.toBeInTheDocument();

    rerender(<TargetSection api={fakeClient([])} showNotes heading="H" emptyText="x" />);
    expect(await screen.findByLabelText('Motivação')).toBeInTheDocument();
  });
});
