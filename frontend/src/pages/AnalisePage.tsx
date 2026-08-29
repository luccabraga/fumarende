import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';
import { spendingBreakdown, projectSavings, scenarioCatalog, applyCuts } from '../lib/analysis.js';
import { BarBreakdown } from '../components/BarBreakdown.js';
import { useMonth } from '../context/MonthContext.js';

const cardGap = { marginBottom: 24 } as const;
const h2Style = { fontFamily: 'var(--mono)', fontSize: 15, marginBottom: 10 } as const;

export function AnalisePage() {
  const { month } = useMonth();
  const [income, setIncome] = useState<api.IncomeEntry[]>([]);
  const [expenses, setExpenses] = useState<api.Expense[]>([]);
  const [fund, setFund] = useState<api.EmergencyFundEntry[]>([]);
  const [target, setTarget] = useState<api.MonthlyTarget | null>(null);
  const [goalsSavedCents, setGoalsSavedCents] = useState(0);
  const [cuts, setCuts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [inc, exp, ef, tgt, goals, projects] = await Promise.all([
          api.listIncome(),
          api.listExpenses(),
          api.listEmergencyFund(),
          api.getMonthlyTarget(month),
          api.goalsApi.list(),
          api.projectsApi.list(),
        ]);
        setIncome(inc);
        setExpenses(exp);
        setFund(ef);
        setTarget(tgt);
        setGoalsSavedCents([...goals, ...projects].reduce((s, t) => s + t.currentCents, 0));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar a análise');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

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
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Análise</h1>

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="card" style={cardGap}>
        <h2 style={h2Style}>Resumo</h2>
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          <div>Receitas: {formatCentsBRL(breakdown.totalIncomeCents)}</div>
          <div>Gastos: {formatCentsBRL(breakdown.totalExpensesCents)}</div>
          <div style={{ color: breakdown.balanceCents < 0 ? 'var(--text3)' : undefined }}>
            Saldo: {formatCentsBRL(breakdown.balanceCents)}
          </div>
          <div>Essencial: {formatCentsBRL(breakdown.essentialCents)}</div>
          <div>Não-essencial: {formatCentsBRL(breakdown.nonEssentialCents)}</div>
        </div>
      </div>

      <div className="card" style={cardGap}>
        <h2 style={h2Style}>Gastos por categoria</h2>
        <BarBreakdown
          rows={breakdown.byCategory.map((c) => ({ label: c.category, cents: c.cents }))}
          emptyText="Nenhum gasto registrado."
        />
      </div>

      <div className="card" style={cardGap}>
        <h2 style={h2Style}>Projeção 12 meses</h2>
        {target && target.targetCents === 0 ? (
          <p style={{ color: 'var(--text3)', fontSize: 13 }}>
            Configure sua meta mensal em Reserva para projetar.
          </p>
        ) : (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              <div>Em 12 meses: {formatCentsBRL(projection.endTotalCents)}</div>
              <div>Poupança acumulada: {formatCentsBRL(projection.endSavingsCents)}</div>
            </div>
            <svg
              viewBox="0 0 320 80"
              preserveAspectRatio="none"
              style={{ width: '100%', height: 80, marginTop: 10 }}
            >
              <polyline points={polylinePoints} fill="none" stroke="var(--cyan)" strokeWidth="2" />
            </svg>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: 'var(--text3)',
              }}
            >
              <span>mês 1</span>
              <span>mês 12</span>
            </div>
          </>
        )}
      </div>

      <div className="card" style={cardGap}>
        <h2 style={h2Style}>Cenários</h2>
        {catalog.length === 0 ? (
          <p style={{ color: 'var(--text3)', fontSize: 13 }}>
            Registre gastos não-essenciais para simular cortes.
          </p>
        ) : (
          <>
            {catalog.map((c) => (
              <div
                key={c.category}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ flex: 1, fontSize: 12.5 }}>
                  {c.category}
                  <span style={{ color: 'var(--text3)' }}>
                    {' '}
                    — {formatCentsBRL(c.monthlyAvgCents)}/mês
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={cuts[c.category] ?? 0}
                  aria-label={`Corte de ${c.category}`}
                  onChange={(e) =>
                    setCuts((prev) => ({ ...prev, [c.category]: Number(e.target.value) }))
                  }
                />
                <span style={{ width: 40, fontSize: 12.5, color: 'var(--text2)' }}>
                  {cuts[c.category] ?? 0}%
                </span>
              </div>
            ))}
            <div style={{ marginTop: 10, fontSize: 13 }}>
              Corte total: {formatCentsBRL(scenario.totalMonthlyCents)}/mês ·{' '}
              {formatCentsBRL(scenario.annualCents)} em 12 meses
            </div>
          </>
        )}
      </div>
    </div>
  );
}
