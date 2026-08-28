import { useEffect, useMemo, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, formatCentsUSD, parseCentsFromInput, parseRate } from '../lib/money.js';
import { quoteStats } from '../lib/dollar.js';

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;
const currentMonth = () => new Date().toISOString().slice(0, 7);

export function HistoricoDolarPage() {
  const [quotes, setQuotes] = useState<api.DollarQuote[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [rateInput, setRateInput] = useState('');
  const [salaryInput, setSalaryInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setQuotes(await api.listDollarQuotes());
  }

  useEffect(() => {
    refresh();
  }, []);

  const stats = useMemo(() => quoteStats(quotes), [quotes]);

  const chartPoints = useMemo(() => {
    if (stats.rows.length < 2) return '';
    const rates = stats.rows.map((r) => r.rate);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const span = max - min || 1;
    const w = 320;
    const h = 80;
    return stats.rows
      .map((r, i) => {
        const x = (i / (stats.rows.length - 1)) * w;
        const y = h - ((r.rate - min) / span) * (h - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [stats]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!month) {
      setError('Informe o mês');
      return;
    }
    const rate = parseRate(rateInput);
    if (Number.isNaN(rate) || rate <= 0) {
      setError('Cotação inválida');
      return;
    }
    let salaryUsdCents: number | null = null;
    if (salaryInput.trim() !== '') {
      const parsed = parseCentsFromInput(salaryInput);
      if (Number.isNaN(parsed) || parsed < 0) {
        setError('Salário inválido');
        return;
      }
      salaryUsdCents = parsed;
    }

    try {
      await api.upsertDollarQuote(month, { rate, salaryUsdCents });
      setRateInput('');
      setSalaryInput('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(m: string) {
    setError(null);
    try {
      await api.deleteDollarQuote(m);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 8 }}>Histórico Dólar</h1>
      <p style={{ color: 'var(--text3)', fontSize: 12.5, marginBottom: 20 }}>
        Como a cotação afeta seu salário em reais.
      </p>

      <form
        onSubmit={handleSubmit}
        className="card"
        style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="dol-month" style={fieldStyle}>Mês</label>
          <input id="dol-month" type="month" className="field-input" value={month}
            onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div>
          <label htmlFor="dol-rate" style={fieldStyle}>Cotação</label>
          <input id="dol-rate" type="text" className="field-input" value={rateInput}
            placeholder="5,12" onChange={(e) => setRateInput(e.target.value)} />
        </div>
        <div>
          <label htmlFor="dol-salary" style={fieldStyle}>Salário no mês (US$)</label>
          <input id="dol-salary" type="text" className="field-input" value={salaryInput}
            onChange={(e) => setSalaryInput(e.target.value)} />
        </div>
        <button type="submit" className="button-primary">Registrar cotação</button>
      </form>

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      {stats.rows.length >= 2 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <svg viewBox="0 0 320 80" preserveAspectRatio="none" style={{ width: '100%', height: 80 }}>
            <polyline points={chartPoints} fill="none" stroke="var(--cyan)" strokeWidth="2" />
          </svg>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--text3)',
            }}
          >
            <span>{stats.rows[0].month}</span>
            <span>{stats.rows[stats.rows.length - 1].month}</span>
          </div>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        {quotes.length === 0 ? (
          <p style={{ color: 'var(--text3)' }}>Nenhuma cotação registrada.</p>
        ) : (
          <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text3)' }}>
                <th style={{ padding: '6px 8px' }}>Mês</th>
                <th style={{ padding: '6px 8px' }}>Cotação</th>
                <th style={{ padding: '6px 8px' }}>Salário (US$)</th>
                <th style={{ padding: '6px 8px' }}>Salário (R$)</th>
                <th style={{ padding: '6px 8px' }}>vs média</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {stats.rows.map((r) => (
                <tr key={r.month} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>{r.month}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)' }}>
                    {r.rate.toFixed(4)}
                  </td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)' }}>
                    {r.salaryUsdCents !== null ? formatCentsUSD(r.salaryUsdCents) : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)' }}>
                    {r.salaryBrlCents !== null ? formatCentsBRL(r.salaryBrlCents) : '—'}
                  </td>
                  <td
                    style={{ padding: '6px 8px', fontFamily: 'var(--mono)', color: 'var(--text2)' }}
                  >
                    {r.vsAveragePct >= 0 ? '+' : ''}
                    {r.vsAveragePct.toFixed(2)}%
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.month)}
                      aria-label={`Excluir cotação de ${r.month}`}
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
