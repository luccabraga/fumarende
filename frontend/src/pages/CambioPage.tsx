import { useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, formatCentsUSD, parseCentsFromInput, parseRate } from '../lib/money.js';
import { calcCambio } from '../lib/cambio.js';
import { useResource } from '../lib/useResource.js';
import { useFormErrors } from '../lib/useFormErrors.js';
import { AsyncBoundary } from '../components/AsyncBoundary.js';
import { EmptyState } from '../components/EmptyState.js';
import { PageHeader } from '../components/PageHeader.js';
import { useToast } from '../context/ToastContext.js';

const INSTITUTIONS = ['Banco Inter', 'Wise', 'Avenue', 'Nomad', 'Outro'];

export function CambioPage() {
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const r = useResource(() => api.listExchangeContracts(), []);
  const contracts = r.data ?? [];
  const { toast } = useToast();
  const f = useFormErrors();
  const [date, setDate] = useState(todayISO);
  const [institution, setInstitution] = useState(INSTITUTIONS[0]);
  const [operationType, setOperationType] = useState<'compra' | 'venda'>('compra');
  const [amountUsd, setAmountUsd] = useState('');
  const [rateInput, setRateInput] = useState('');
  const [ptaxInput, setPtaxInput] = useState('');
  const [iof, setIof] = useState('0');
  const [bankFee, setBankFee] = useState('0');
  const [sourcePdfRef, setSourcePdfRef] = useState('');
  const [notes, setNotes] = useState('');

  // Parsed form values, recomputed each render for the live preview.
  const amountUsdCents = parseCentsFromInput(amountUsd);
  const rate = parseRate(rateInput);
  const ptax = ptaxInput.trim() === '' ? null : parseRate(ptaxInput);
  const iofCents = parseCentsFromInput(iof);
  const bankFeeCents = parseCentsFromInput(bankFee);

  const ptaxValid = ptax === null || (!Number.isNaN(ptax) && ptax > 0);
  const previewValid =
    !Number.isNaN(amountUsdCents) &&
    amountUsdCents > 0 &&
    !Number.isNaN(rate) &&
    rate > 0 &&
    !Number.isNaN(iofCents) &&
    !Number.isNaN(bankFeeCents) &&
    ptaxValid;

  const preview = previewValid
    ? calcCambio({
        amountUsdCents,
        contractedRate: rate,
        ptaxRate: ptax,
        iofCents,
        bankFeeCents,
      })
    : null;

  function validateAmountUsd() {
    if (Number.isNaN(amountUsdCents) || amountUsdCents <= 0)
      f.setError('amountUsd', 'Valor em USD inválido');
    else f.clearError('amountUsd');
  }
  function validateRate() {
    if (Number.isNaN(rate) || rate <= 0) f.setError('rate', 'Taxa cambial inválida');
    else f.clearError('rate');
  }
  function validatePtax() {
    if (ptaxInput.trim() !== '' && (ptax === null || Number.isNaN(ptax) || ptax <= 0))
      f.setError('ptax', 'PTAX inválida');
    else f.clearError('ptax');
  }
  function validateFees() {
    if (Number.isNaN(iofCents) || Number.isNaN(bankFeeCents))
      f.setError('fees', 'IOF ou tarifa inválidos');
    else f.clearError('fees');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    validateAmountUsd();
    validateRate();
    validatePtax();
    validateFees();

    if (Number.isNaN(amountUsdCents) || amountUsdCents <= 0) return;
    if (Number.isNaN(rate) || rate <= 0) return;
    if (ptaxInput.trim() !== '' && (ptax === null || Number.isNaN(ptax) || ptax <= 0)) return;
    if (Number.isNaN(iofCents) || Number.isNaN(bankFeeCents)) return;

    try {
      await api.createExchangeContract({
        date,
        institution,
        operationType,
        amountUsdCents,
        contractedRate: rate,
        ptaxRate: ptaxInput.trim() === '' ? null : ptax,
        iofCents,
        bankFeeCents,
        sourcePdfRef: sourcePdfRef || null,
        notes: notes || null,
      });
      setDate(todayISO());
      setAmountUsd('');
      setRateInput('');
      setPtaxInput('');
      setIof('0');
      setBankFee('0');
      setSourcePdfRef('');
      setNotes('');
      f.clearAll();
      toast('success', 'Operação registrada');
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteExchangeContract(id);
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  const totalUsdCents = contracts.reduce((s, c) => s + c.amountUsdCents, 0);
  const totalNetCents = contracts.reduce((s, c) => s + c.netBrlCents, 0);
  const totalFeesCents = contracts.reduce((s, c) => s + c.iofCents + c.bankFeeCents, 0);
  const avgVet = totalUsdCents > 0 ? totalNetCents / totalUsdCents : 0;
  const ptaxContracts = contracts.filter((c) => c.ptaxRate !== null);
  const avgPtax =
    ptaxContracts.length > 0
      ? ptaxContracts.reduce((s, c) => s + (c.ptaxRate ?? 0), 0) / ptaxContracts.length
      : 0;
  const avgSpreadPct = avgPtax > 0 ? ((avgPtax - avgVet) / avgPtax) * 100 : null;

  return (
    <div className="page">
      <PageHeader
        title="Câmbio"
        subtitle="Registre a operação de conversão com o banco. A receita em USD entra em Receitas."
      />

      <form onSubmit={handleSubmit} className="card form-grid">
        <div className="field">
          <label className="field-label" htmlFor="cambio-date">Data</label>
          <input id="cambio-date" type="date" className="field-input" value={date}
            onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cambio-institution">Instituição</label>
          <select id="cambio-institution" className="field-input" value={institution}
            onChange={(e) => setInstitution(e.target.value)}>
            {INSTITUTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cambio-operation">Operação</label>
          <select id="cambio-operation" className="field-input" value={operationType}
            onChange={(e) => setOperationType(e.target.value as 'compra' | 'venda')}>
            <option value="compra">Compra (recebo BRL)</option>
            <option value="venda">Venda (envio BRL)</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cambio-amount-usd">Valor (US$)</label>
          <input id="cambio-amount-usd" type="text" className="field-input" value={amountUsd}
            aria-invalid={!!f.errors.amountUsd} onBlur={validateAmountUsd}
            onChange={(e) => setAmountUsd(e.target.value)} />
          {f.errors.amountUsd && (
            <span className="field-error" role="alert">{f.errors.amountUsd}</span>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cambio-rate">Taxa cambial</label>
          <input id="cambio-rate" type="text" className="field-input" value={rateInput}
            placeholder="5,0994" aria-invalid={!!f.errors.rate} onBlur={validateRate}
            onChange={(e) => setRateInput(e.target.value)} />
          {f.errors.rate && (
            <span className="field-error" role="alert">{f.errors.rate}</span>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cambio-ptax">PTAX (opcional)</label>
          <input id="cambio-ptax" type="text" className="field-input" value={ptaxInput}
            aria-invalid={!!f.errors.ptax} onBlur={validatePtax}
            onChange={(e) => setPtaxInput(e.target.value)} />
          {f.errors.ptax && (
            <span className="field-error" role="alert">{f.errors.ptax}</span>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cambio-iof">IOF (R$)</label>
          <input id="cambio-iof" type="text" className="field-input" value={iof}
            aria-invalid={!!f.errors.fees} onBlur={validateFees}
            onChange={(e) => setIof(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cambio-bank-fee">Tarifa (R$)</label>
          <input id="cambio-bank-fee" type="text" className="field-input" value={bankFee}
            aria-invalid={!!f.errors.fees} onBlur={validateFees}
            onChange={(e) => setBankFee(e.target.value)} />
          {f.errors.fees && (
            <span className="field-error" role="alert">{f.errors.fees}</span>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cambio-ref">Nº comprovante / referência</label>
          <input id="cambio-ref" type="text" className="field-input" value={sourcePdfRef}
            onChange={(e) => setSourcePdfRef(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cambio-notes">Observação</label>
          <input id="cambio-notes" type="text" className="field-input" value={notes}
            onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button type="submit" className="button-primary">+ Registrar operação</button>
      </form>

      {preview && (
        <div className="card data-list mono">
          <div>BRL bruto: {formatCentsBRL(preview.grossBrlCents)}</div>
          <div>IOF + tarifas: {formatCentsBRL(preview.totalFeesCents)}</div>
          <div>BRL líquido: {formatCentsBRL(preview.netBrlCents)}</div>
          <div>VET: {formatCentsBRL(Math.round(preview.vetRate * 100))}/USD</div>
          <div>
            Spread vs PTAX:{' '}
            {preview.spreadBrlCents !== null && preview.spreadPct !== null
              ? `${formatCentsBRL(preview.spreadBrlCents)} (${preview.spreadPct.toFixed(2)}%)`
              : '— (sem PTAX)'}
          </div>
        </div>
      )}

      {contracts.length > 0 && (
        <div className="card data-list">
          <div>Total convertido: {formatCentsUSD(totalUsdCents)}</div>
          <div>BRL líquido recebido: {formatCentsBRL(totalNetCents)}</div>
          <div>Total em taxas: {formatCentsBRL(totalFeesCents)}</div>
          <div>VET médio: {formatCentsBRL(Math.round(avgVet * 100))}/USD</div>
          {avgPtax > 0 && (
            <div>
              PTAX média: {formatCentsBRL(Math.round(avgPtax * 100))}
              {avgSpreadPct !== null && ` — spread médio ${avgSpreadPct.toFixed(2)}%`}
            </div>
          )}
        </div>
      )}

      <AsyncBoundary loading={r.loading} error={r.error} onRetry={r.reload}>
      <div className="card">
        {contracts.length === 0 && <EmptyState message="Nenhuma operação ainda." />}
        {contracts.map((c) => (
          <div key={c.id} className="list-row">
            <span className="muted">{c.date}</span>
            <span>{c.institution}</span>
            <span className="subtle">{c.operationType}</span>
            <span className="mono">
              {formatCentsUSD(c.amountUsdCents)} → {formatCentsBRL(c.netBrlCents)}
            </span>
            <span className="mono muted">
              VET {(c.netBrlCents / c.amountUsdCents).toFixed(4)}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(c.id)}
              aria-label={`Excluir operação de ${c.date}`}
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
