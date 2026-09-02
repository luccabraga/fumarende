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
    <div className="card stack-sm">
      <div className="dash-goal-head">
        <strong>{target.name}</strong>
        {p.complete && (
          <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)' }}>
            Concluída
          </span>
        )}
      </div>

      <div className="mono" style={{ fontSize: 'var(--text-sm)' }}>
        {formatCentsBRL(target.currentCents)} de {formatCentsBRL(target.targetCents)}
      </div>

      <div className="dash-goal-track">
        <div className="dash-goal-fill" style={{ width: `${p.progressPct}%` }} />
      </div>

      {!p.complete && (
        <div className="subtle">
          Faltam {formatCentsBRL(p.remainingCents)}
          {p.suggestedMonthlyCents !== null &&
            ` — sugestão ${formatCentsBRL(p.suggestedMonthlyCents)}/mês`}
        </div>
      )}

      {showNotes && target.notes && (
        <p className="subtle" style={{ fontStyle: 'italic' }}>“{target.notes}”</p>
      )}

      <div className="row">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-label={`Adicionar à meta ${target.name}`}
          className="link-btn"
        >
          Adicionar
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-label={`Editar ${target.name}`}
          className="link-btn"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={() => onDelete(target.id)}
          aria-label={`Excluir ${target.name}`}
          className="link-btn"
        >
          Excluir
        </button>
      </div>

      {adding && (
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor={`add-${target.id}`}>
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
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor={`edit-name-${target.id}`}>Nome</label>
            <input id={`edit-name-${target.id}`} type="text" className="field-input"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`edit-target-${target.id}`}>Valor (R$)</label>
            <input id={`edit-target-${target.id}`} type="text" className="field-input"
              value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`edit-current-${target.id}`}>Valor atual (R$)</label>
            <input id={`edit-current-${target.id}`} type="text" className="field-input"
              value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`edit-date-${target.id}`}>Data alvo</label>
            <input id={`edit-date-${target.id}`} type="date" className="field-input"
              value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
          </div>
          {showNotes && (
            <div className="field">
              <label className="field-label" htmlFor={`edit-notes-${target.id}`}>Motivação</label>
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
