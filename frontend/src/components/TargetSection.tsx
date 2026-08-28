import { useEffect, useState, type FormEvent } from 'react';
import type { TargetsClient, Target } from '../lib/api.js';
import { parseCentsFromInput } from '../lib/money.js';
import { TargetCard } from './TargetCard.js';

interface TargetSectionProps {
  api: TargetsClient;
  showNotes: boolean;
  heading: string;
  emptyText: string;
}

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;

export function TargetSection({ api, showNotes, heading, emptyText }: TargetSectionProps) {
  const [items, setItems] = useState<Target[]>([]);
  const [name, setName] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [dateValue, setDateValue] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [notesValue, setNotesValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setItems(await api.list());
  }

  useEffect(() => {
    refresh();
  }, [api]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const targetCents = parseCentsFromInput(targetValue);
    if (name.trim() === '' || Number.isNaN(targetCents) || targetCents <= 0) {
      setError('Informe um nome e um valor válido');
      return;
    }
    const currentCents = currentValue.trim() === '' ? undefined : parseCentsFromInput(currentValue);
    if (currentCents !== undefined && (Number.isNaN(currentCents) || currentCents < 0)) {
      setError('Valor já guardado inválido');
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
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  function wrap<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
    return (...a: A) => {
      fn(...a)
        .then(refresh)
        .catch((err) => setError(err instanceof Error ? err.message : 'Erro desconhecido'));
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
          <input id="tgt-name" type="text" className="field-input" value={name}
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

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      {items.length === 0 ? (
        <p style={{ color: 'var(--text3)' }}>{emptyText}</p>
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
    </div>
  );
}
