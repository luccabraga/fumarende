import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, parseCentsFromInput } from '../lib/money.js';
import { CATEGORIES, PAYMENT_METHODS } from '../lib/expenses.js';

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;

export function FixedExpensesSection({ onApplied }: { onApplied?: () => void }) {
  const [templates, setTemplates] = useState<api.FixedExpense[]>([]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [type, setType] = useState<'essencial' | 'nao-essencial'>('essencial');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setTemplates(await api.listFixedExpenses());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const amountCents = parseCentsFromInput(amount);
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      setError('Valor inválido');
      return;
    }

    try {
      await api.createFixedExpense({ description, amountCents, category, type, paymentMethod });
      setDescription('');
      setAmount('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await api.deleteFixedExpense(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleApply() {
    setError(null);
    setStatus(null);
    const month = new Date().toISOString().slice(0, 7);
    try {
      const { created } = await api.applyFixedExpenses(month);
      setStatus(`${created} gasto(s) aplicado(s) a ${month}.`);
      onApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--mono)', fontSize: 16, marginBottom: 12 }}>Gastos fixos</h2>

      <div className="card" style={{ marginBottom: 12 }}>
        {templates.length === 0 && (
          <p style={{ color: 'var(--text3)' }}>Nenhum gasto fixo cadastrado.</p>
        )}
        {templates.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ flex: 1 }}>{t.description}</span>
            <span style={{ color: 'var(--text3)', fontSize: 12 }}>{t.category}</span>
            <span style={{ fontFamily: 'var(--mono)' }}>{formatCentsBRL(t.amountCents)}</span>
            <button
              type="button"
              onClick={() => handleDelete(t.id)}
              aria-label={`Excluir gasto fixo ${t.description}`}
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

      <form
        onSubmit={handleAdd}
        className="card"
        style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="fixed-description" style={fieldStyle}>Descrição do gasto fixo</label>
          <input id="fixed-description" type="text" className="field-input" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label htmlFor="fixed-amount" style={fieldStyle}>Valor do gasto fixo (R$)</label>
          <input id="fixed-amount" type="text" className="field-input" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label htmlFor="fixed-category" style={fieldStyle}>Categoria do gasto fixo</label>
          <select id="fixed-category" className="field-input" value={category}
            onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="fixed-type" style={fieldStyle}>Tipo do gasto fixo</label>
          <select id="fixed-type" className="field-input" value={type}
            onChange={(e) => setType(e.target.value as 'essencial' | 'nao-essencial')}>
            <option value="essencial">Essencial</option>
            <option value="nao-essencial">Não-essencial</option>
          </select>
        </div>
        <div>
          <label htmlFor="fixed-payment" style={fieldStyle}>Forma de pagamento do gasto fixo</label>
          <select id="fixed-payment" className="field-input" value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button type="submit" className="button-primary">+ Adicionar fixo</button>
      </form>

      <button type="button" className="button-primary" onClick={handleApply}>
        Aplicar ao mês atual
      </button>
      {status && <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text2)' }}>{status}</p>}
      {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
