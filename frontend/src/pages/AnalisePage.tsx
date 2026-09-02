import { useMemo, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';
import { spendingBreakdown, projectSavings, scenarioCatalog, applyCuts } from '../lib/analysis.js';
import { BarBreakdown } from '../components/BarBreakdown.js';
import { ConsultorIA } from '../components/ConsultorIA.js';
import { AiUsageSection } from '../components/AiUsageSection.js';
import { useMonth } from '../context/MonthContext.js';
import { useResource } from '../lib/useResource.js';
import { AsyncBoundary } from '../components/AsyncBoundary.js';
import { PageHeader } from '../components/PageHeader.js';

export function AnalisePage() {
  const { month } = useMonth();
  const r = useResource(
    () =>
      Promise.all([
        api.listIncome(),
        api.listExpenses(),
        api.listEmergencyFund(),
        api.getMonthlyTarget(month),
        api.goalsApi.list(),
        api.projectsApi.list(),
      ]),
    [month],
  );
  const [income, expenses, fund, target, goals, projects] = r.data ?? [
    [] as api.IncomeEntry[],
    [] as api.Expense[],
    [] as api.EmergencyFundEntry[],
    null,
    [] as api.Target[],
    [] as api.Target[],
  ];
  const goalsSavedCents = [...goals, ...projects].reduce((s, t) => s + t.currentCents, 0);
  const [cuts, setCuts] = useState<Record<string, number>>({});

  const breakdown = useMemo(() => spendingBreakdown(income, expenses), [income, expenses]);
  const reserveBalanceCents = useMemo(
    () => fund.reduce((s, e) => s + e.amountCents, 0),
    [fund],
  );
  const projection = useMemo(
    () =>
      projectSavings({
        reserveBalanceCents,
        monthlyTargetCents: target?.targetCents ?? 0,
        goalsSavedCents,
      }),
    [reserveBalanceCents, target, goalsSavedCents],
  );
  const catalog = useMemo(() => scenarioCatalog(expenses), [expenses]);
  const scenario = useMemo(() => applyCuts(catalog, cuts), [catalog, cuts]);

  const polylinePoints = useMemo(() => {
    const totals = projection.rows.map((r) => r.totalCents);
    const max = Math.max(...totals, 1);
    const w = 320;
    const h = 80;
    return projection.rows
      .map((r, i) => {
        const x = (i / (projection.rows.length - 1 || 1)) * w;
        const y = h - (r.totalCents / max) * (h - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [projection]);

  return (
    <div className="page">
      <PageHeader title="Análise" />

      <AsyncBoundary loading={r.loading} error={r.error} onRetry={r.reload} skeletonRows={4}>
      <div className="card">
        <h2 className="section-title">Resumo</h2>
        <div className="data-list">
          <div>Receitas: {formatCentsBRL(breakdown.totalIncomeCents)}</div>
          <div>Gastos: {formatCentsBRL(breakdown.totalExpensesCents)}</div>
          <div style={{ color: breakdown.balanceCents < 0 ? 'var(--text3)' : undefined }}>
            Saldo: {formatCentsBRL(breakdown.balanceCents)}
          </div>
          <div>Essencial: {formatCentsBRL(breakdown.essentialCents)}</div>
          <div>Não-essencial: {formatCentsBRL(breakdown.nonEssentialCents)}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Gastos por categoria</h2>
        <BarBreakdown
          rows={breakdown.byCategory.map((c) => ({ label: c.category, cents: c.cents }))}
          emptyText="Nenhum gasto registrado."
        />
      </div>

      <div className="card">
        <h2 className="section-title">Projeção 12 meses</h2>
        {target && target.targetCents === 0 ? (
          <p className="subtle">Configure sua meta mensal em Reserva para projetar.</p>
        ) : (
          <div className="stack-sm">
            <div className="data-list">
              <div>Em 12 meses: {formatCentsBRL(projection.endTotalCents)}</div>
              <div>Poupança acumulada: {formatCentsBRL(projection.endSavingsCents)}</div>
            </div>
            <svg viewBox="0 0 320 80" preserveAspectRatio="none" className="chart-svg">
              <polyline points={polylinePoints} fill="none" stroke="var(--cyan)" strokeWidth="2" />
            </svg>
            <div className="subtle" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>mês 1</span>
              <span>mês 12</span>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="section-title">Cenários</h2>
        {catalog.length === 0 ? (
          <p className="subtle">Registre gastos não-essenciais para simular cortes.</p>
        ) : (
          <div className="stack-sm">
            {catalog.map((c) => (
              <div key={c.category} className="list-row" style={{ alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  {c.category}
                  <span className="subtle"> — {formatCentsBRL(c.monthlyAvgCents)}/mês</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={cuts[c.category] ?? 0}
                  aria-label={`Corte de ${c.category}`}
                  aria-valuetext={`${cuts[c.category] ?? 0}%`}
                  onChange={(e) =>
                    setCuts((prev) => ({ ...prev, [c.category]: Number(e.target.value) }))
                  }
                />
                <span className="muted" style={{ width: 40 }}>
                  {cuts[c.category] ?? 0}%
                </span>
              </div>
            ))}
            <div className="subtle">
              Corte total: {formatCentsBRL(scenario.totalMonthlyCents)}/mês ·{' '}
              {formatCentsBRL(scenario.annualCents)} em 12 meses
            </div>
          </div>
        )}
      </div>

      </AsyncBoundary>

      <ConsultorIA />
      <AiUsageSection />
    </div>
  );
}
