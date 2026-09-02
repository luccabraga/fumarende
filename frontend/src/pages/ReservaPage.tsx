import { useEffect, useMemo, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, parseCentsFromInput } from '../lib/money.js';
import { essentialAverage, reserveTiers } from '../lib/reserva.js';
import { useMonth } from '../context/MonthContext.js';
import { useResource } from '../lib/useResource.js';
import { useFormErrors } from '../lib/useFormErrors.js';
import { AsyncBoundary } from '../components/AsyncBoundary.js';
import { EmptyState } from '../components/EmptyState.js';
import { PageHeader } from '../components/PageHeader.js';
import { useToast } from '../context/ToastContext.js';

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
  const f = useFormErrors();
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

  function validateAmount(fieldKey: string, raw: string) {
    const c = parseCentsFromInput(raw);
    if (Number.isNaN(c) || c <= 0) f.setError(fieldKey, 'Valor inválido');
    else f.clearError(fieldKey);
  }

  async function submitEntry(
    kind: 'deposit' | 'withdrawal',
    date: string,
    rawAmount: string,
    notes: string,
    reset: () => void,
  ) {
    const fieldKey = kind === 'deposit' ? 'depositAmount' : 'withdrawAmount';
    validateAmount(fieldKey, rawAmount);
    const amountCents = parseCentsFromInput(rawAmount);
    if (Number.isNaN(amountCents) || amountCents <= 0) return;
    try {
      await api.createEmergencyFundEntry({ kind, date, amountCents, notes: notes || null });
      reset();
      f.clearError(kind === 'deposit' ? 'depositAmount' : 'withdrawAmount');
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
    <div className="page">
      <PageHeader title="Reserva de emergência" />

      {r.data && (
        <div className="card data-list">
          <div>Já guardado: {formatCentsBRL(balance)}</div>
          <div>Meta 3 meses: {formatCentsBRL(tiers.target3Cents)}</div>
          <div>Meta ideal 6 meses: {formatCentsBRL(tiers.target6Cents)}</div>
          <div>Progresso: {tiers.progressPct.toFixed(0)}%</div>
          <div style={{ marginTop: 'var(--space-2)' }}>{TIER_MESSAGE[tiers.tier]}</div>
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
        className="card form-grid"
      >
        <div className="field">
          <label className="field-label" htmlFor="dep-date">Data do depósito</label>
          <input id="dep-date" type="date" className="field-input" value={depositDate}
            onChange={(e) => setDepositDate(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="dep-amount">Valor do depósito (R$)</label>
          <input id="dep-amount" type="text" className="field-input" value={depositAmount}
            aria-invalid={!!f.errors.depositAmount}
            aria-describedby={f.errors.depositAmount ? 'dep-amount-error' : undefined}
            onBlur={() => validateAmount('depositAmount', depositAmount)}
            onChange={(e) => setDepositAmount(e.target.value)} />
          {f.errors.depositAmount && (
            <span className="field-error" role="alert" id="dep-amount-error">{f.errors.depositAmount}</span>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="dep-notes">Descrição</label>
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
        className="card form-grid"
      >
        <div className="field">
          <label className="field-label" htmlFor="wd-date">Data da retirada</label>
          <input id="wd-date" type="date" className="field-input" value={withdrawDate}
            onChange={(e) => setWithdrawDate(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="wd-amount">Valor da retirada (R$)</label>
          <input id="wd-amount" type="text" className="field-input" value={withdrawAmount}
            aria-invalid={!!f.errors.withdrawAmount}
            aria-describedby={f.errors.withdrawAmount ? 'wd-amount-error' : undefined}
            onBlur={() => validateAmount('withdrawAmount', withdrawAmount)}
            onChange={(e) => setWithdrawAmount(e.target.value)} />
          {f.errors.withdrawAmount && (
            <span className="field-error" role="alert" id="wd-amount-error">{f.errors.withdrawAmount}</span>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="wd-notes">Motivo</label>
          <input id="wd-notes" type="text" className="field-input" value={withdrawNotes}
            onChange={(e) => setWithdrawNotes(e.target.value)} />
        </div>
        <button type="submit" className="button-primary">− Retirar da reserva</button>
        {withdrawExceedsBalance && (
          <p className="subtle" style={{ width: '100%' }}>
            O valor da retirada é maior que o saldo atual ({formatCentsBRL(balance)}).
          </p>
        )}
      </form>

      <form onSubmit={handleSaveTarget} className="card stack-sm">
        <h2 className="section-title">Meta mensal</h2>
        <div className="data-list">
          <div>
            Meta mensal: {formatCentsBRL(totalTarget)}
            {(target?.rolloverCents ?? 0) > 0 &&
              ` (inclui ${formatCentsBRL(target!.rolloverCents)} de déficit anterior)`}
          </div>
          <div>Adicionado este mês: {formatCentsBRL(addedThisMonth)}</div>
          <div>
            {diff >= 0
              ? `✅ Meta batida — sobra ${formatCentsBRL(diff)}`
              : `⚠️ Faltam ${formatCentsBRL(-diff)}`}
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="meta-mode">Tipo de meta</label>
            <select id="meta-mode" className="field-input" value={pctOrFixed}
              onChange={(e) => setPctOrFixed(e.target.value as 'pct' | 'fixed')}>
              <option value="pct">% do salário</option>
              <option value="fixed">Valor fixo (R$)</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="meta-pct">Percentual da meta</label>
            <input id="meta-pct" type="number" min="1" max="100" className="field-input"
              value={pctInput} onChange={(e) => setPctInput(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="meta-fixed">Valor fixo da meta (R$)</label>
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
          <div key={e.id} className="list-row">
            <span className="muted">{e.date}</span>
            <span style={{ flex: 1 }}>{e.notes ?? '—'}</span>
            <span className="mono">
              {e.amountCents < 0 ? '− ' : '+ '}
              {formatCentsBRL(Math.abs(e.amountCents))}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(e.id)}
              aria-label={`Excluir lançamento de ${e.date}`}
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
