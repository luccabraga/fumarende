import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TargetCard } from './TargetCard.js';
import type { Target } from '../lib/api.js';

function target(over: Partial<Target>): Target {
  return {
    id: 1,
    name: 'PS5',
    targetCents: 400_000,
    currentCents: 100_000,
    targetDate: null,
    notes: null,
    status: 'active',
    ...over,
  };
}

const noop = () => {};

describe('TargetCard', () => {
  it('shows current/target and a remaining line for an in-progress target', () => {
    render(
      <TargetCard target={target({})} showNotes={false} onAdd={noop} onUpdate={noop} onDelete={noop} />,
    );
    expect(screen.getByText('R$ 1.000,00 de R$ 4.000,00')).toBeInTheDocument();
    expect(screen.getByText(/Faltam R\$ 3\.000,00/)).toBeInTheDocument();
  });

  it('shows the Concluída badge and no remaining line when met', () => {
    render(
      <TargetCard
        target={target({ currentCents: 400_000 })}
        showNotes={false}
        onAdd={noop}
        onUpdate={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText('Concluída')).toBeInTheDocument();
    expect(screen.queryByText(/Faltam/)).not.toBeInTheDocument();
  });

  it('adds a contribution via the Adicionar control', () => {
    const onAdd = vi.fn();
    render(
      <TargetCard target={target({})} showNotes={false} onAdd={onAdd} onUpdate={noop} onDelete={noop} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar à meta PS5' }));
    fireEvent.change(screen.getByLabelText('Valor a adicionar em PS5'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar adição em PS5' }));
    expect(onAdd).toHaveBeenCalledWith(1, 5_000);
  });

  it('deletes via the Excluir control', () => {
    const onDelete = vi.fn();
    render(
      <TargetCard target={target({})} showNotes={false} onAdd={noop} onUpdate={noop} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Excluir PS5' }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it('hides the motivation text when showNotes is false', () => {
    render(
      <TargetCard
        target={target({ notes: 'liberdade' })}
        showNotes={false}
        onAdd={noop}
        onUpdate={noop}
        onDelete={noop}
      />,
    );
    expect(screen.queryByText(/liberdade/)).not.toBeInTheDocument();
  });
});
