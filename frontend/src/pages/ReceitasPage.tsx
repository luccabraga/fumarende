import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, formatCentsUSD, parseCentsFromInput } from '../lib/money.js';

export function ReceitasPage() {
  const [entries, setEntries] = useState<api.IncomeEntry[]>([]);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [amountUsd, setAmountUsd] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setEntries(await api.listIncome());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const amountBrlCents = parseCentsFromInput(amount);
    if (Number.isNaN(amountBrlCents) || amountBrlCents <= 0) {
      setError('Valor inválido');
      return;
    }

    let amountUsdCents: number | null = null;
    if (amountUsd.trim() !== '') {
      const parsed = parseCentsFromInput(amountUsd);
      if (Number.isNaN(parsed) || parsed <= 0) {
        setError('Valor em USD inválido');
        return;
      }
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
      setDate('');
      setAmount('');
      setAmountUsd('');
      setDescription('');
      setSource('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await api.deleteIncome(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Receitas</h1>

      <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="date" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            Data
          </label>
          <input
            id="date"
            type="date"
            className="field-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="amount" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            Valor (R$)
          </label>
          <input
            id="amount"
            type="text"
            className="field-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="amount-usd" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            Valor (US$)
          </label>
          <input
            id="amount-usd"
            type="text"
            className="field-input"
            value={amountUsd}
            onChange={(e) => setAmountUsd(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="description" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            Descrição
          </label>
          <input
            id="description"
            type="text"
            className="field-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="source" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            Origem
          </label>
          <input
            id="source"
            type="text"
            className="field-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </div>
        <button type="submit" className="button-primary">
          Adicionar
        </button>
      </form>

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="card">
        {entries.length === 0 && <p style={{ color: 'var(--text3)' }}>Nenhum lançamento ainda.</p>}
        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span>{entry.description ?? '—'}</span>
            <span style={{ color: 'var(--text2)' }}>{entry.date}</span>
            <span style={{ fontFamily: 'var(--mono)' }}>
              {formatCentsBRL(entry.amountBrlCents)}
              {entry.amountUsdCents !== null && ` (${formatCentsUSD(entry.amountUsdCents)})`}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(entry.id)}
              aria-label={`Excluir lançamento de ${entry.date}`}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 12.5,
                color: 'var(--text3)',
                cursor: 'pointer',
              }}
            >
              Excluir
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
