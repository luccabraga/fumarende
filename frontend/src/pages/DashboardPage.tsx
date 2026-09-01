import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';
import { BarBreakdown } from '../components/BarBreakdown.js';
import { useMonth } from '../context/MonthContext.js';

const ALERT_CLASS: Record<api.DashboardSummary['alerts'][number]['level'], string> = {
  info: 'muted',
  warning: 'dash-alert-warning',
  danger: 'dash-alert-danger',
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
    return <span className="subtle">— sem mês anterior</span>;
  }
  const deltaPct = ((current - previous) / previous) * 100;
  if (Math.abs(deltaPct) < 0.5) {
    return <span className="subtle">= igual a {previousMonth}</span>;
  }
  const up = deltaPct > 0;
  const good = up === upIsGood;
  return (
    <span className={`subtle ${good ? 'dash-delta-up' : 'dash-delta-down'}`}>
      {up ? '↑' : '↓'} {Math.abs(Math.round(deltaPct))}% vs {previousMonth}
    </span>
  );
}

export function DashboardPage() {
  const { month } = useMonth();
  const [summary, setSummary] = useState<api.DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setSummary(await api.getDashboard(month));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar o dashboard');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

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
      <h1 className="page-title">Dashboard</h1>

      {error && <p className="error-text">{error}</p>}

      {summary && (
        <div className="stack">
          <p className="subtle">{summary.month}</p>

          <div className="card row">
            <div>
              <div className="subtle">Receita do mês</div>
              <div className="dash-stat">{formatCentsBRL(summary.income.currentCents)}</div>
              <Delta
                current={summary.income.currentCents}
                previous={summary.income.previousCents}
                previousMonth={summary.previousMonth}
                upIsGood
              />
            </div>
            <div>
              <div className="subtle">Gastos do mês</div>
              <div className="dash-stat">{formatCentsBRL(summary.expenses.currentCents)}</div>
              {summary.income.currentCents > 0 && (
                <span className="subtle">
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
              <div className="subtle">Disponível</div>
              <div className="dash-stat">{formatCentsBRL(summary.balanceCents)}</div>
            </div>
            <div>
              <div className="subtle">Reserva</div>
              <div className="dash-stat">{formatCentsBRL(summary.reserveBalanceCents)}</div>
            </div>
          </div>

          {summary.alerts.length > 0 && (
            <div className="card">
              <h2 className="section-title">Alertas</h2>
              <div className="stack-sm">
                {summary.alerts.map((a, i) => (
                  <div key={i} className={ALERT_CLASS[a.level]}>
                    {a.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h2 className="section-title">Gastos por categoria</h2>
            <BarBreakdown
              rows={summary.expenses.byCategory.map((c) => ({ label: c.category, cents: c.cents }))}
              emptyText="Nenhum gasto este mês."
            />
          </div>

          <div className="card">
            <h2 className="section-title">Evolução (6 meses)</h2>
            <svg viewBox="0 0 320 90" preserveAspectRatio="none" className="dash-evo">
              <polyline
                points={evoPoints('incomeCents')}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
              />
              <polyline
                points={evoPoints('expensesCents')}
                fill="none"
                stroke="var(--text-subtle)"
                strokeWidth="2"
              />
            </svg>
            <div className="dash-evo-legend">
              <span>{summary.evolution[0].month}</span>
              <span>
                <span className="dash-delta-up">—</span> receitas{' '}
                <span className="subtle">—</span> gastos
              </span>
              <span>{summary.evolution[summary.evolution.length - 1].month}</span>
            </div>
          </div>

          <div className="card">
            <h2 className="section-title">Últimos gastos</h2>
            {summary.recentExpenses.length === 0 ? (
              <p className="muted">Nenhum gasto ainda.</p>
            ) : (
              summary.recentExpenses.map((e, i) => (
                <div key={i} className="dash-list-row">
                  <span className="muted">{e.date}</span>
                  <span style={{ flex: 1 }}>{e.description}</span>
                  <span className="subtle">{e.category}</span>
                  <span className="mono">{formatCentsBRL(e.amountCents)}</span>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <h2 className="section-title">Metas em andamento</h2>
            {summary.topGoals.length === 0 ? (
              <p className="muted">Nenhuma meta ainda.</p>
            ) : (
              <div className="stack-sm">
                {summary.topGoals.map((g, i) => (
                  <div key={i}>
                    <div className="dash-goal-head">
                      <span>{g.name}</span>
                      <span className="mono muted">
                        {formatCentsBRL(g.currentCents)} de {formatCentsBRL(g.targetCents)}
                      </span>
                    </div>
                    <div className="dash-goal-track">
                      <div className="dash-goal-fill" style={{ width: `${g.progressPct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {summary.installments.activeGroups > 0 && (
            <div className="card">
              <h2 className="section-title">Parcelas ativas</h2>
              <div className="stack-sm">
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
            <h2 className="section-title">Fechamento do mês</h2>
            <label className="row-sm">
              <input
                type="checkbox"
                checked={summary.monthlyClose.reviewed}
                aria-label={`Revisado ${summary.month}`}
                onChange={toggleClose}
              />
              <span>Mês revisado</span>
              {summary.monthlyClose.reviewed && summary.monthlyClose.reviewedAt && (
                <span className="subtle">
                  revisado em{' '}
                  {new Date(summary.monthlyClose.reviewedAt).toLocaleDateString('pt-BR')}
                </span>
              )}
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
