import { useRef, useState, type FormEvent } from 'react';
import type { TargetsClient, Target } from '../lib/api.js';
import { parseCentsFromInput } from '../lib/money.js';
import { TargetCard } from './TargetCard.js';
import { useResource } from '../lib/useResource.js';
import { AsyncBoundary } from './AsyncBoundary.js';
import { EmptyState } from './EmptyState.js';
import { useToast } from '../context/ToastContext.js';

interface TargetSectionProps {
  api: TargetsClient;
  showNotes: boolean;
  heading: string;
  emptyText: string;
}

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;

export function TargetSection({ api, showNotes, heading, emptyText }: TargetSectionProps) {
  const r = useResource(() => api.list(), [api]);
  const items = r.data ?? [];
  const { toast } = useToast();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [dateValue, setDateValue] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [notesValue, setNotesValue] = useState('');

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const targetCents = parseCentsFromInput(targetValue);
    if (name.trim() === '' || Number.isNaN(targetCents) || targetCents <= 0) {
      toast('error', 'Informe um nome e um valor válido');
      return;
    }
    const currentCents = currentValue.trim() === '' ? undefined : parseCentsFromInput(currentValue);
    if (currentCents !== undefined && (Number.isNaN(currentCents) || currentCents < 0)) {
      toast('error', 'Valor já guardado inválido');
      return;
    }
    try {
      await api.create({
        name,
        targetCents,
        currentCents,
        targetDate: dateValue || null,
        notes: showNotes ? notesValue || null : null,
      });
      setName('');
      setTargetValue('');
      setDateValue('');
      setCurrentValue('');
      setNotesValue('');
      toast('success', 'Criado');
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  function wrap<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
    return (...a: A) => {
      fn(...a)
        .then(() => r.reload())
        .catch((err) =>
          toast('error', err instanceof Error ? err.message : 'Erro desconhecido'),
        );
    };
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--mono)', fontSize: 15, marginBottom: 12 }}>{heading}</h2>

      <form
        onSubmit={handleCreate}
        className="card"
        style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="tgt-name" style={fieldStyle}>Nome</label>
          <input id="tgt-name" ref={nameRef} type="text" className="field-input" value={name}
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="tgt-value" style={fieldStyle}>Valor (R$)</label>
          <input id="tgt-value" type="text" className="field-input" value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)} />
        </div>
        <div>
          <label htmlFor="tgt-date" style={fieldStyle}>Data alvo</label>
          <input id="tgt-date" type="date" className="field-input" value={dateValue}
            onChange={(e) => setDateValue(e.target.value)} />
        </div>
        <div>
          <label htmlFor="tgt-current" style={fieldStyle}>Valor já guardado (R$)</label>
          <input id="tgt-current" type="text" className="field-input" value={currentValue}
            onChange={(e) => setCurrentValue(e.target.value)} />
        </div>
        {showNotes && (
          <div>
            <label htmlFor="tgt-notes" style={fieldStyle}>Motivação</label>
            <input id="tgt-notes" type="text" className="field-input" value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)} />
          </div>
        )}
        <button type="submit" className="button-primary">Criar</button>
      </form>

      <AsyncBoundary loading={r.loading} error={r.error} onRetry={r.reload}>
        {items.length === 0 ? (
          <EmptyState
            message={emptyText}
            action={
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => nameRef.current?.focus()}
              >
                Criar a primeira
              </button>
            }
          />
        ) : (
          items.map((t) => (
            <TargetCard
              key={t.id}
              target={t}
              showNotes={showNotes}
              onAdd={wrap(api.addTo)}
              onUpdate={wrap(api.update)}
              onDelete={wrap(api.remove)}
            />
          ))
        )}
      </AsyncBoundary>
    </div>
  );
}
