import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';
import { BarBreakdown } from '../components/BarBreakdown.js';

const cardGap = { marginBottom: 24 } as const;
const h2Style = { fontFamily: 'var(--mono)', fontSize: 15, marginBottom: 10 } as const;
const ALERT_COLOR: Record<api.DashboardSummary['alerts'][number]['level'], string> = {
  info: 'var(--text2)',
  warning: 'var(--gold, var(--text))',
  danger: 'var(--red, var(--text))',
};

function Delta({
  current,
  previous,
  previousMonth,
  upIsGood,
}: {
  current: number;
  previous: number;
  previousMonth: string;
  upIsGood: boolean;
}) {
  if (previous === 0) {
    return <span style={{ fontSize: 11, color: 'var(--text3)' }}>— sem mês anterior</span>;
  }
  const deltaPct = ((current - previous) / previous) * 100;
  if (Math.abs(deltaPct) < 0.5) {
    return <span style={{ fontSize: 11, color: 'var(--text3)' }}>= igual a {previousMonth}</span>;
  }
  const up = deltaPct > 0;
  const good = up === upIsGood;
  return (
    <span style={{ fontSize: 11, color: good ? 'var(--cyan)' : 'var(--red, var(--text))' }}>
      {up ? '↑' : '↓'} {Math.abs(Math.round(deltaPct))}% vs {previousMonth}
    </span>
  );
}

export function DashboardPage() {
  const [summary, setSummary] = useState<api.DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setSummary(await api.getDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar o dashboard');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleClose() {
    if (!summary) return;
    try {
      if (summary.monthlyClose.reviewed) await api.unmarkMonthReviewed(summary.month);
      else await api.markMonthReviewed(summary.month);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  const evoPoints = (key: 'incomeCents' | 'expensesCents'): string => {
    if (!summary) return '';
    const vals = summary.evolution.flatMap((e) => [e.incomeCents, e.expensesCents]);
    const max = Math.max(...vals, 1);
    const w = 320;
    const h = 90;
    return summary.evolution
      .map((e, i) => {
        const x = (i / (summary.evolution.length - 1)) * w;
        const y = h - (e[key] / max) * (h - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 8 }}>Dashboard</h1>
      {summary && (
        <p style={{ color: 'var(--text3)', fontSize: 12.5, marginBottom: 20 }}>{summary.month}</p>
      )}

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      {summary && (
        <>
          <div
            className="card"
            style={{ ...cardGap, display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13 }}
          >
            <div>
              <div style={{ color: 'var(--text3)', fontSize: 11 }}>Receita do mês</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 16 }}>
                {formatCentsBRL(summary.income.currentCents)}
              </div>
              <Delta
                current={summary.income.currentCents}
                previous={summary.income.previousCents}
                previousMonth={summary.previousMonth}
                upIsGood
              />
            </div>
            <div>
              <div style={{ color: 'var(--text3)', fontSize: 11 }}>Gastos do mês</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 16 }}>
                {formatCentsBRL(summary.expenses.currentCents)}
              </div>
              {summary.income.currentCents > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {Math.round((summary.expenses.currentCents / summary.income.currentCents) * 100)}% da
                  renda{' · '}
                </span>
              )}
              <Delta
                current={summary.expenses.currentCents}
                previous={summary.expenses.previousCents}
                previousMonth={summary.previousMonth}
                upIsGood={false}
              />
            </div>
            <div>
              <div style={{ color: 'var(--text3)', fontSize: 11 }}>Disponível</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 16 }}>
                {formatCentsBRL(summary.balanceCents)}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text3)', fontSize: 11 }}>Reserva</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 16 }}>
                {formatCentsBRL(summary.reserveBalanceCents)}
              </div>
            </div>
          </div>

          {summary.alerts.length > 0 && (
            <div className="card" style={cardGap}>
              <h2 style={h2Style}>Alertas</h2>
              {summary.alerts.map((a, i) => (
                <div key={i} style={{ fontSize: 12.5, color: ALERT_COLOR[a.level], marginBottom: 4 }}>
                  {a.message}
                </div>
              ))}
            </div>
          )}

          <div className="card" style={cardGap}>
            <h2 style={h2Style}>Gastos por categoria</h2>
            <BarBreakdown
              rows={summary.expenses.byCategory.map((c) => ({ label: c.category, cents: c.cents }))}
              emptyText="Nenhum gasto este mês."
            />
          </div>

          <div className="card" style={cardGap}>
            <h2 style={h2Style}>Evolução (6 meses)</h2>
            <svg viewBox="0 0 320 90" preserveAspectRatio="none" style={{ width: '100%', height: 90 }}>
              <polyline
                points={evoPoints('incomeCents')}
                fill="none"
                stroke="var(--cyan)"
                strokeWidth="2"
              />
              <polyline
                points={evoPoints('expensesCents')}
                fill="none"
                stroke="var(--text3)"
                strokeWidth="2"
              />
            </svg>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: 'var(--text3)',
              }}
            >
              <span>{summary.evolution[0].month}</span>
              <span>
                <span style={{ color: 'var(--cyan)' }}>—</span> receitas{' '}
                <span style={{ color: 'var(--text3)' }}>—</span> gastos
              </span>
              <span>{summary.evolution[summary.evolution.length - 1].month}</span>
            </div>
          </div>

          <div className="card" style={cardGap}>
            <h2 style={h2Style}>Últimos gastos</h2>
            {summary.recentExpenses.length === 0 ? (
              <p style={{ color: 'var(--text3)' }}>Nenhum gasto ainda.</p>
            ) : (
              summary.recentExpenses.map((e, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ color: 'var(--text2)' }}>{e.date}</span>
                  <span style={{ flex: 1 }}>{e.description}</span>
                  <span style={{ color: 'var(--text3)' }}>{e.category}</span>
                  <span style={{ fontFamily: 'var(--mono)' }}>{formatCentsBRL(e.amountCents)}</span>
                </div>
              ))
            )}
          </div>

          <div className="card" style={cardGap}>
            <h2 style={h2Style}>Metas em andamento</h2>
            {summary.topGoals.length === 0 ? (
              <p style={{ color: 'var(--text3)' }}>Nenhuma meta ainda.</p>
            ) : (
              summary.topGoals.map((g, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12.5,
                      marginBottom: 3,
                    }}
                  >
                    <span>{g.name}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
                      {formatCentsBRL(g.currentCents)} de {formatCentsBRL(g.targetCents)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: 'var(--border)',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{ width: `${g.progressPct}%`, height: '100%', background: 'var(--cyan)' }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {summary.installments.activeGroups > 0 && (
            <div className="card" style={cardGap}>
              <h2 style={h2Style}>Parcelas ativas</h2>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div>
                  Próximo mês: {formatCentsBRL(summary.installments.nextMonthCommitmentCents)}
                </div>
                <div>{summary.installments.activeGroups} parcelamento(s) ativo(s)</div>
                {summary.installments.earliestEndMonth && (
                  <div>Mais curto termina em {summary.installments.earliestEndMonth}</div>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <h2 style={h2Style}>Fechamento do mês</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={summary.monthlyClose.reviewed}
                aria-label={`Revisado ${summary.month}`}
                onChange={toggleClose}
              />
              <span>Mês revisado</span>
              {summary.monthlyClose.reviewed && summary.monthlyClose.reviewedAt && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  revisado em{' '}
                  {new Date(summary.monthlyClose.reviewedAt).toLocaleDateString('pt-BR')}
                </span>
              )}
            </label>
          </div>
        </>
      )}
    </div>
  );
}
