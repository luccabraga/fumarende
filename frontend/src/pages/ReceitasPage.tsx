import { useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, formatCentsUSD, parseCentsFromInput } from '../lib/money.js';
import { useResource } from '../lib/useResource.js';
import { useFormErrors } from '../lib/useFormErrors.js';
import { AsyncBoundary } from '../components/AsyncBoundary.js';
import { EmptyState } from '../components/EmptyState.js';
import { Field } from '../components/Field.js';
import { PageHeader } from '../components/PageHeader.js';
import { useToast } from '../context/ToastContext.js';

export function ReceitasPage() {
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const r = useResource(() => api.listIncome(), []);
  const { toast } = useToast();
  const f = useFormErrors();
  const [date, setDate] = useState(todayISO);
  const [amount, setAmount] = useState('');
  const [amountUsd, setAmountUsd] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');

  function validateAmount() {
    const c = parseCentsFromInput(amount);
    if (Number.isNaN(c) || c <= 0) f.setError('amount', 'Valor inválido');
    else f.clearError('amount');
  }

  function validateAmountUsd() {
    if (amountUsd.trim() === '') {
      f.clearError('amountUsd');
      return;
    }
    const c = parseCentsFromInput(amountUsd);
    if (Number.isNaN(c) || c <= 0) f.setError('amountUsd', 'Valor em USD inválido');
    else f.clearError('amountUsd');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    validateAmount();
    validateAmountUsd();

    const amountBrlCents = parseCentsFromInput(amount);
    if (Number.isNaN(amountBrlCents) || amountBrlCents <= 0) return;

    let amountUsdCents: number | null = null;
    if (amountUsd.trim() !== '') {
      const parsed = parseCentsFromInput(amountUsd);
      if (Number.isNaN(parsed) || parsed <= 0) return;
      amountUsdCents = parsed;
    }

    try {
      await api.createIncome({
        date,
        amountBrlCents,
        amountUsdCents,
        description: description || null,
        source: source || null,
      });
      setDate(todayISO());
      setAmount('');
      setAmountUsd('');
      setDescription('');
      setSource('');
      f.clearAll();
      toast('success', 'Receita adicionada');
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteIncome(id);
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div className="page">
      <PageHeader title="Receitas" />

      <form onSubmit={handleSubmit} className="card form-grid">
        <Field label="Data" htmlFor="rec-date">
          <input
            id="rec-date"
            type="date"
            className="field-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Valor (R$)" htmlFor="rec-amount" error={f.errors.amount}>
          <input
            id="rec-amount"
            type="text"
            className="field-input"
            value={amount}
            aria-invalid={!!f.errors.amount}
            onBlur={validateAmount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Valor (US$)" htmlFor="rec-amount-usd" error={f.errors.amountUsd}>
          <input
            id="rec-amount-usd"
            type="text"
            className="field-input"
            value={amountUsd}
            aria-invalid={!!f.errors.amountUsd}
            onBlur={validateAmountUsd}
            onChange={(e) => setAmountUsd(e.target.value)}
          />
        </Field>
        <Field label="Descrição" htmlFor="rec-description">
          <input
            id="rec-description"
            type="text"
            className="field-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Origem" htmlFor="rec-source">
          <input
            id="rec-source"
            type="text"
            className="field-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </Field>
        <button type="submit" className="button-primary">
          Adicionar
        </button>
      </form>

      <AsyncBoundary loading={r.loading} error={r.error} onRetry={r.reload}>
        <div className="card">
          {(r.data ?? []).length === 0 && (
            <EmptyState message="Nenhum lançamento ainda." />
          )}
          {(r.data ?? []).map((entry) => (
            <div key={entry.id} className="list-row">
              <span>{entry.description ?? '—'}</span>
              <span className="muted">{entry.date}</span>
              <span className="mono">
                {formatCentsBRL(entry.amountBrlCents)}
                {entry.amountUsdCents !== null && ` (${formatCentsUSD(entry.amountUsdCents)})`}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(entry.id)}
                aria-label={`Excluir lançamento de ${entry.date}`}
                className="link-btn"
              >
                Excluir
              </button>
            </div>
          ))}
        </div>
      </AsyncBoundary>
    </div>
  );
}
