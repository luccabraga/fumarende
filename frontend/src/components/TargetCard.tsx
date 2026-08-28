import { useState } from 'react';
import type { Target } from '../lib/api.js';
import { formatCentsBRL, parseCentsFromInput } from '../lib/money.js';
import { targetProgress } from '../lib/targets.js';

interface TargetCardProps {
  target: Target;
  showNotes: boolean;
  onAdd: (id: number, deltaCents: number) => void;
  onUpdate: (id: number, patch: Partial<Target>) => void;
  onDelete: (id: number) => void;
}

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;

const ghostBtn = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 12.5,
  color: 'var(--text3)',
  cursor: 'pointer',
} as const;

export function TargetCard({ target, showNotes, onAdd, onUpdate, onDelete }: TargetCardProps) {
  const p = targetProgress(target);
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(target.name);
  const [targetValue, setTargetValue] = useState((target.targetCents / 100).toFixed(2));
  const [currentValue, setCurrentValue] = useState((target.currentCents / 100).toFixed(2));
  const [dateValue, setDateValue] = useState(target.targetDate ?? '');
  const [notesValue, setNotesValue] = useState(target.notes ?? '');

  function confirmAdd() {
    const cents = parseCentsFromInput(addValue);
    if (Number.isNaN(cents) || cents <= 0) return;
    onAdd(target.id, cents);
    setAddValue('');
    setAdding(false);
  }

  function confirmEdit() {
    const patch: Partial<Target> = { name };
    const t = parseCentsFromInput(targetValue);
    const c = parseCentsFromInput(currentValue);
    if (!Number.isNaN(t)) patch.targetCents = t;
    if (!Number.isNaN(c)) patch.currentCents = c;
    patch.targetDate = dateValue || null;
    if (showNotes) patch.notes = notesValue || null;
    onUpdate(target.id, patch);
    setEditing(false);
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>{target.name}</strong>
        {p.complete && (
          <span style={{ fontSize: 12, color: 'var(--cyan)', fontFamily: 'var(--mono)' }}>
            Concluída
          </span>
        )}
      </div>

      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, margin: '6px 0' }}>
        {formatCentsBRL(target.currentCents)} de {formatCentsBRL(target.targetCents)}
      </div>

      <div
        style={{
          height: 6,
          background: 'var(--border)',
          borderRadius: 3,
          overflow: 'hidden',
          marginBottom: 6,
        }}
      >
        <div style={{ width: `${p.progressPct}%`, height: '100%', background: 'var(--cyan)' }} />
      </div>

      {!p.complete && (
        <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
          Faltam {formatCentsBRL(p.remainingCents)}
          {p.suggestedMonthlyCents !== null &&
            ` — sugestão ${formatCentsBRL(p.suggestedMonthlyCents)}/mês`}
        </div>
      )}

      {showNotes && target.notes && (
        <p style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic', margin: '6px 0 0' }}>
          “{target.notes}”
        </p>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-label={`Adicionar à meta ${target.name}`}
          style={ghostBtn}
        >
          Adicionar
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-label={`Editar ${target.name}`}
          style={ghostBtn}
        >
          Editar
        </button>
        <button
          type="button"
          onClick={() => onDelete(target.id)}
          aria-label={`Excluir ${target.name}`}
          style={ghostBtn}
        >
          Excluir
        </button>
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
          <div>
            <label htmlFor={`add-${target.id}`} style={fieldStyle}>
              Valor a adicionar em {target.name}
            </label>
            <input
              id={`add-${target.id}`}
              type="text"
              className="field-input"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="button-primary"
            onClick={confirmAdd}
            aria-label={`Confirmar adição em ${target.name}`}
          >
            OK
          </button>
        </div>
      )}

      {editing && (
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'flex-end' }}
        >
          <div>
            <label htmlFor={`edit-name-${target.id}`} style={fieldStyle}>Nome</label>
            <input id={`edit-name-${target.id}`} type="text" className="field-input"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`edit-target-${target.id}`} style={fieldStyle}>Valor (R$)</label>
            <input id={`edit-target-${target.id}`} type="text" className="field-input"
              value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`edit-current-${target.id}`} style={fieldStyle}>Valor atual (R$)</label>
            <input id={`edit-current-${target.id}`} type="text" className="field-input"
              value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`edit-date-${target.id}`} style={fieldStyle}>Data alvo</label>
            <input id={`edit-date-${target.id}`} type="date" className="field-input"
              value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
          </div>
          {showNotes && (
            <div>
              <label htmlFor={`edit-notes-${target.id}`} style={fieldStyle}>Motivação</label>
              <input id={`edit-notes-${target.id}`} type="text" className="field-input"
                value={notesValue} onChange={(e) => setNotesValue(e.target.value)} />
            </div>
          )}
          <button type="button" className="button-primary" onClick={confirmEdit}>
            Salvar
          </button>
        </div>
      )}
    </div>
  );
}
