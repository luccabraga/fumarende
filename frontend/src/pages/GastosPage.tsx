import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, parseCentsFromInput } from '../lib/money.js';
import { CATEGORIES, PAYMENT_METHODS } from '../lib/expenses.js';
import { FixedExpensesSection } from '../components/FixedExpensesSection.js';
import { CategoryRulesSection } from '../components/CategoryRulesSection.js';
import { StatementImportSection } from '../components/StatementImportSection.js';

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;
const AUTO = '';

export function GastosPage() {
  const [expenses, setExpenses] = useState<api.Expense[]>([]);
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>(AUTO);
  const [type, setType] = useState<'essencial' | 'nao-essencial'>('essencial');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [installments, setInstallments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);

  async function refresh() {
    setExpenses(await api.listExpenses());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const amountCents = parseCentsFromInput(amount);
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      setError('Valor inválido');
      return;
    }

    let installmentTotal: number | null = null;
    if (installments.trim() !== '') {
      const parsed = Number(installments);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setError('Número de parcelas inválido');
        return;
      }
      installmentTotal = parsed;
    }

    try {
      await api.createExpense({
        date,
        description,
        amountCents,
        category,
        type,
        paymentMethod,
        installmentTotal,
        notes: null,
      });
      setDate('');
      setDescription('');
      setAmount('');
      setInstallments('');
      setCategory(AUTO);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function sweep() {
    setSweeping(true);
    setSweepMsg(null);
    try {
      const r = await api.categorizePending();
      await refresh();
      setSweepMsg(
        `${r.updated} categorizados · ${r.stillPending} pendentes${
          r.stoppedAtCap ? ' (limite de IA atingido)' : ''
        }`,
      );
    } catch {
      setSweepMsg('Falha ao categorizar.');
    } finally {
      setSweeping(false);
    }
  }

  async function handleDelete(entry: api.Expense) {
    setError(null);
    try {
      if (entry.installmentGroupId) {
        await api.deleteExpenseGroup(entry.installmentGroupId);
      } else {
        await api.deleteExpense(entry.id);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  const total = expenses.reduce((s, e) => s + e.amountCents, 0);
  const essencial = expenses
    .filter((e) => e.type === 'essencial')
    .reduce((s, e) => s + e.amountCents, 0);
  const pendingCount = expenses.filter((e) => e.category === '').length;

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Gastos</h1>

      <form
        onSubmit={handleSubmit}
        className="card"
        style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="gasto-date" style={fieldStyle}>Data</label>
          <input id="gasto-date" type="date" className="field-input" value={date}
            onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gasto-description" style={fieldStyle}>Descrição</label>
          <input id="gasto-description" type="text" className="field-input" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gasto-amount" style={fieldStyle}>Valor (R$)</label>
          <input id="gasto-amount" type="text" className="field-input" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gasto-category" style={fieldStyle}>Categoria</label>
          <select id="gasto-category" className="field-input" value={category}
            onChange={(e) => setCategory(e.target.value)}>
            <option value="">Automático (regras + IA)</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="gasto-type" style={fieldStyle}>Tipo</label>
          <select id="gasto-type" className="field-input" value={type}
            onChange={(e) => setType(e.target.value as 'essencial' | 'nao-essencial')}>
            <option value="essencial">Essencial</option>
            <option value="nao-essencial">Não-essencial</option>
          </select>
        </div>
        <div>
          <label htmlFor="gasto-payment" style={fieldStyle}>Forma de pagamento</label>
          <select id="gasto-payment" className="field-input" value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="gasto-installments" style={fieldStyle}>Parcelas</label>
          <input id="gasto-installments" type="number" min="1" className="field-input"
            value={installments} onChange={(e) => setInstallments(e.target.value)} />
        </div>
        <button type="submit" className="button-primary">+ Adicionar gasto</button>
      </form>

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      {expenses.length > 0 && (
        <div className="card" style={{ marginBottom: 20, fontSize: 13 }}>
          <div>Total: {formatCentsBRL(total)}</div>
          <div>Essencial: {formatCentsBRL(essencial)}</div>
          <div>Não-essencial: {formatCentsBRL(total - essencial)}</div>
        </div>
      )}

      {pendingCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="button-primary" disabled={sweeping} onClick={sweep}>
            {sweeping ? 'Categorizando…' : `Categorizar pendentes (${pendingCount})`}
          </button>
          {sweepMsg && (
            <span style={{ marginLeft: 10, fontSize: 12.5, color: 'var(--text3)' }}>{sweepMsg}</span>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 32 }}>
        {expenses.length === 0 && <p style={{ color: 'var(--text3)' }}>Nenhum gasto ainda.</p>}
        {expenses.map((e) => (
          <div
            key={e.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ color: 'var(--text2)' }}>{e.date}</span>
            <span style={{ flex: 1 }}>
              {e.description}
              {e.installmentTotal !== null && ` (${e.installmentNumber}/${e.installmentTotal})`}
            </span>
            <span style={{ color: 'var(--text3)', fontSize: 12 }}>
              {e.category ? (
                e.category
              ) : (
                <span style={{ fontStyle: 'italic' }}>— sem categoria</span>
              )}
            </span>
            <span style={{ fontFamily: 'var(--mono)' }}>{formatCentsBRL(e.amountCents)}</span>
            <button
              type="button"
              onClick={() => handleDelete(e)}
              aria-label={`Excluir gasto de ${e.date}`}
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

      <FixedExpensesSection onApplied={refresh} />
      <CategoryRulesSection />
      <StatementImportSection onImported={refresh} />
    </div>
  );
}
