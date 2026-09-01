import { useEffect, useMemo, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, parseCentsFromInput } from '../lib/money.js';
import { essentialAverage, reserveTiers } from '../lib/reserva.js';
import { useMonth } from '../context/MonthContext.js';
import { useResource } from '../lib/useResource.js';
import { AsyncBoundary } from '../components/AsyncBoundary.js';
import { EmptyState } from '../components/EmptyState.js';
import { useToast } from '../context/ToastContext.js';

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;
const today = () => new Date().toISOString().slice(0, 10);

const TIER_MESSAGE: Record<ReturnType<typeof reserveTiers>['tier'], string> = {
  'no-data': 'Registre seus gastos essenciais em Gastos para calcular a reserva ideal.',
  'below-3': '🚨 Abaixo do mínimo recomendado (3 meses).',
  'below-6': '⚠️ Bom progresso — meta ideal é 6 meses.',
  complete: '✅ Reserva completa (6+ meses).',
};

export function ReservaPage() {
  const { month } = useMonth();
  const { toast } = useToast();
  const r = useResource(
    () =>
      Promise.all([
        api.listEmergencyFund(),
        api.listExpenses(),
        api.getMonthlyTarget(month),
      ]),
    [month],
  );
  const [entries, expenses, target] = r.data ?? [
    [] as api.EmergencyFundEntry[],
    [] as api.Expense[],
    null,
  ];

  const [depositDate, setDepositDate] = useState(today());
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNotes, setDepositNotes] = useState('');

  const [withdrawDate, setWithdrawDate] = useState(today());
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawNotes, setWithdrawNotes] = useState('');

  const [pctOrFixed, setPctOrFixed] = useState<'pct' | 'fixed'>('pct');
  const [pctInput, setPctInput] = useState('');
  const [fixedInput, setFixedInput] = useState('');

  // Sync the Meta Mensal form fields from the loaded target each time it (re)loads.
  useEffect(() => {
    if (!target) return;
    setPctOrFixed(target.pctOrFixed === 'fixed' ? 'fixed' : 'pct');
    setPctInput(target.pctValue !== null ? String(target.pctValue) : '');
    setFixedInput(
      target.fixedValueCents !== null ? (target.fixedValueCents / 100).toFixed(2) : '',
    );
  }, [target]);

  const balance = useMemo(() => entries.reduce((s, e) => s + e.amountCents, 0), [entries]);
  const { averageCents } = useMemo(() => essentialAverage(expenses), [expenses]);
  const tiers = useMemo(() => reserveTiers(balance, averageCents), [balance, averageCents]);

  const addedThisMonth = entries
    .filter((e) => e.date.startsWith(month))
    .reduce((s, e) => s + e.amountCents, 0);
  const totalTarget = (target?.targetCents ?? 0) + (target?.rolloverCents ?? 0);
  const diff = addedThisMonth - totalTarget;

  const withdrawCents = parseCentsFromInput(withdrawAmount);
  const withdrawExceedsBalance =
    !Number.isNaN(withdrawCents) && withdrawCents > 0 && withdrawCents > balance;

  async function submitEntry(
    kind: 'deposit' | 'withdrawal',
    date: string,
    rawAmount: string,
    notes: string,
    reset: () => void,
  ) {
    const amountCents = parseCentsFromInput(rawAmount);
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      toast('error', 'Valor inválido');
      return;
    }
    try {
      await api.createEmergencyFundEntry({ kind, date, amountCents, notes: notes || null });
      reset();
      toast('success', kind === 'deposit' ? 'Depósito registrado' : 'Retirada registrada');
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleSaveTarget(event: FormEvent) {
    event.preventDefault();
    try {
      await api.updateMonthlyTarget(month, {
        pctOrFixed,
        pctValue: pctOrFixed === 'pct' && pctInput.trim() !== '' ? Number(pctInput) : null,
        fixedValueCents:
          pctOrFixed === 'fixed' && fixedInput.trim() !== ''
            ? parseCentsFromInput(fixedInput)
            : null,
      });
      toast('success', 'Meta do mês salva');
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteEmergencyFundEntry(id);
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div>
      <h1 className="page-title">Reserva de emergência</h1>

      {r.data && (
        <div className="card" style={{ marginBottom: 20, fontSize: 13 }}>
          <div>Já guardado: {formatCentsBRL(balance)}</div>
          <div>Meta 3 meses: {formatCentsBRL(tiers.target3Cents)}</div>
          <div>Meta ideal 6 meses: {formatCentsBRL(tiers.target6Cents)}</div>
          <div>Progresso: {tiers.progressPct.toFixed(0)}%</div>
          <div style={{ marginTop: 8 }}>{TIER_MESSAGE[tiers.tier]}</div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitEntry('deposit', depositDate, depositAmount, depositNotes, () => {
            setDepositAmount('');
            setDepositNotes('');
          });
        }}
        className="card"
        style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="dep-date" style={fieldStyle}>Data do depósito</label>
          <input id="dep-date" type="date" className="field-input" value={depositDate}
            onChange={(e) => setDepositDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="dep-amount" style={fieldStyle}>Valor do depósito (R$)</label>
          <input id="dep-amount" type="text" className="field-input" value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)} />
        </div>
        <div>
          <label htmlFor="dep-notes" style={fieldStyle}>Descrição</label>
          <input id="dep-notes" type="text" className="field-input" value={depositNotes}
            onChange={(e) => setDepositNotes(e.target.value)} />
        </div>
        <button type="submit" className="button-primary">+ Depositar na reserva</button>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitEntry('withdrawal', withdrawDate, withdrawAmount, withdrawNotes, () => {
            setWithdrawAmount('');
            setWithdrawNotes('');
          });
        }}
        className="card"
        style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="wd-date" style={fieldStyle}>Data da retirada</label>
          <input id="wd-date" type="date" className="field-input" value={withdrawDate}
            onChange={(e) => setWithdrawDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="wd-amount" style={fieldStyle}>Valor da retirada (R$)</label>
          <input id="wd-amount" type="text" className="field-input" value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)} />
        </div>
        <div>
          <label htmlFor="wd-notes" style={fieldStyle}>Motivo</label>
          <input id="wd-notes" type="text" className="field-input" value={withdrawNotes}
            onChange={(e) => setWithdrawNotes(e.target.value)} />
        </div>
        <button type="submit" className="button-primary">− Retirar da reserva</button>
        {withdrawExceedsBalance && (
          <p style={{ width: '100%', margin: 0, fontSize: 12.5, color: 'var(--text3)' }}>
            O valor da retirada é maior que o saldo atual ({formatCentsBRL(balance)}).
          </p>
        )}
      </form>

      <form onSubmit={handleSaveTarget} className="card" style={{ marginBottom: 20, fontSize: 13 }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: 15, marginBottom: 10 }}>Meta mensal</h2>
        <div>
          Meta mensal: {formatCentsBRL(totalTarget)}
          {(target?.rolloverCents ?? 0) > 0 &&
            ` (inclui ${formatCentsBRL(target!.rolloverCents)} de déficit anterior)`}
        </div>
        <div>Adicionado este mês: {formatCentsBRL(addedThisMonth)}</div>
        <div style={{ marginBottom: 10 }}>
          {diff >= 0
            ? `✅ Meta batida — sobra ${formatCentsBRL(diff)}`
            : `⚠️ Faltam ${formatCentsBRL(-diff)}`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="meta-mode" style={fieldStyle}>Tipo de meta</label>
            <select id="meta-mode" className="field-input" value={pctOrFixed}
              onChange={(e) => setPctOrFixed(e.target.value as 'pct' | 'fixed')}>
              <option value="pct">% do salário</option>
              <option value="fixed">Valor fixo (R$)</option>
            </select>
          </div>
          <div>
            <label htmlFor="meta-pct" style={fieldStyle}>Percentual da meta</label>
            <input id="meta-pct" type="number" min="1" max="100" className="field-input"
              value={pctInput} onChange={(e) => setPctInput(e.target.value)} />
          </div>
          <div>
            <label htmlFor="meta-fixed" style={fieldStyle}>Valor fixo da meta (R$)</label>
            <input id="meta-fixed" type="text" className="field-input"
              value={fixedInput} onChange={(e) => setFixedInput(e.target.value)} />
          </div>
          <button type="submit" className="button-primary">Salvar meta do mês</button>
        </div>
      </form>

      <AsyncBoundary loading={r.loading} error={r.error} onRetry={r.reload}>
      <div className="card">
        {entries.length === 0 && <EmptyState message="Nenhum lançamento ainda." />}
        {entries.map((e) => (
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
            <span style={{ flex: 1 }}>{e.notes ?? '—'}</span>
            <span style={{ fontFamily: 'var(--mono)' }}>
              {e.amountCents < 0 ? '− ' : '+ '}
              {formatCentsBRL(Math.abs(e.amountCents))}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(e.id)}
              aria-label={`Excluir lançamento de ${e.date}`}
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
      </AsyncBoundary>
    </div>
  );
}
