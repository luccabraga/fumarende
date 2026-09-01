import { useRef, useState, type ChangeEvent } from 'react';
import * as api from '../lib/api.js';
import { parseCentsFromInput } from '../lib/money.js';
import { CATEGORIES } from '../lib/expenses.js';

/** Cents → a pt-BR string `parseCentsFromInput` round-trips, e.g. 3210 → "32,10". */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;
const cellInput = { width: '100%', boxSizing: 'border-box' } as const;

const KIND_LABEL: Record<api.ImportLineKind, string> = {
  purchase: 'Compra',
  payment: 'Pagamento',
  fee: 'Taxa',
  fx: 'Câmbio',
};

interface EditableRow {
  kind: api.ImportLineKind;
  duplicate: boolean;
  checked: boolean;
  date: string;
  description: string;
  amountText: string;
  category: string;
  type: 'essencial' | 'nao-essencial';
}

function toEditable(r: api.ImportPreviewRow): EditableRow {
  const description = r.installment
    ? `${r.description} (${r.installment.n}/${r.installment.total})`
    : r.description;
  return {
    kind: r.kind,
    duplicate: r.duplicate,
    checked: r.kind === 'purchase' && !r.duplicate,
    date: r.date,
    description,
    amountText: centsToInput(r.amountCents),
    category: r.suggestedCategory,
    type: r.suggestedType,
  };
}

function mapError(err: unknown): string {
  const status = (err as { status?: number }).status;
  if (status === 503) return 'Configure a chave da IA no servidor.';
  if (status === 429) return 'Limite mensal de IA atingido.';
  if (status === 502) return 'Não consegui ler este PDF. Tente outro arquivo.';
  if (status === 400) return err instanceof Error ? err.message : 'Arquivo inválido.';
  return 'Erro ao processar o PDF.';
}

export function StatementImportSection({ onImported }: { onImported?: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'reading' | 'review'>('idle');
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopTick() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function cancelReading() {
    abortRef.current?.abort();
    stopTick();
    setPhase('idle');
    setResult('Leitura cancelada.');
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhase('reading');
    setError(null);
    setResult(null);
    setElapsed(0);

    const started = Date.now();
    stopTick();
    tickRef.current = setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000,
    );

    const ac = new AbortController();
    abortRef.current = ac;

    const reader = new FileReader();
    reader.onerror = () => {
      stopTick();
      setError('Não consegui ler o arquivo.');
      setPhase('idle');
    };
    reader.onload = () => {
      const s = String(reader.result);
      const base64 = s.includes(',') ? s.slice(s.indexOf(',') + 1) : s;
      api
        .importPreviewStatement(base64, file.name, ac.signal)
        .then((preview) => {
          stopTick();
          setRows(preview.rows.map(toEditable));
          setWarnings(preview.warnings);
          setPhase('review');
        })
        .catch((err) => {
          if ((err as { name?: string }).name === 'AbortError') return;
          stopTick();
          setError(mapError(err));
          setPhase('idle');
        });
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function patch(i: number, next: Partial<EditableRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...next } : r)));
  }

  const checkedCount = rows.filter((r) => r.checked).length;

  async function confirm() {
    setError(null);
    const picked = rows.filter((r) => r.checked);
    const payload: api.ImportConfirmRow[] = [];
    for (const r of picked) {
      const amountCents = parseCentsFromInput(r.amountText);
      if (Number.isNaN(amountCents) || amountCents <= 0) {
        setError('Confira os valores das linhas selecionadas.');
        return;
      }
      payload.push({
        date: r.date,
        description: r.description.trim(),
        amountCents,
        category: r.category,
        type: r.type,
      });
    }
    setConfirming(true);
    try {
      const { created } = await api.importConfirmExpenses(payload);
      setResult(`${created} gasto(s) importado(s).`);
      setPhase('idle');
      setRows([]);
      setWarnings([]);
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar.');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontFamily: 'var(--mono)', fontSize: 16, marginBottom: 12 }}>
        Importar extrato (PDF)
      </h2>

      <div className="card">
        <label htmlFor="statement-file" style={fieldStyle}>
          Arquivo do extrato
        </label>
        <input
          id="statement-file"
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Arquivo do extrato"
          onChange={handleFile}
        />

        {phase === 'reading' && (
          <div style={{ marginTop: 10 }}>
            <div className="progress-indeterminate" aria-hidden="true">
              <span />
            </div>
            <p style={{ marginTop: 6, color: 'var(--text3)', fontSize: 13 }}>
              Lendo o extrato com a IA — há {elapsed}s. A leitura costuma levar 20–40
              segundos, não feche a página.
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 6 }}
              onClick={cancelReading}
            >
              Cancelar
            </button>
            <span className="subtle" style={{ marginLeft: 8 }}>
              a leitura já iniciada não é reembolsada
            </span>
          </div>
        )}

        {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
        {result && (
          <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text2)' }}>{result}</p>
        )}

        {phase === 'review' && rows.length === 0 && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>
              Não consegui ler nenhum lançamento deste PDF.
            </p>
            {warnings.length > 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 6 }}>
                {warnings.join(' ')}
              </p>
            )}
            <p style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 6 }}>
              Tente exportar a fatura em outro formato (texto/PDF pesquisável, não digitalizado) e
              enviar de novo.
            </p>
          </div>
        )}

        {phase === 'review' && rows.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {warnings.length > 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 10 }}>
                {warnings.join(' ')}
              </p>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text3)' }}>
                    <th></th>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Categoria</th>
                    <th>Tipo</th>
                    <th>Linha</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Incluir ${r.description}`}
                          checked={r.checked}
                          onChange={(e) => patch(i, { checked: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="field-input"
                          style={cellInput}
                          value={r.date}
                          onChange={(e) => patch(i, { date: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="field-input"
                          style={cellInput}
                          value={r.description}
                          onChange={(e) => patch(i, { description: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="field-input"
                          style={{ ...cellInput, width: 110 }}
                          value={r.amountText}
                          onChange={(e) => patch(i, { amountText: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="field-input"
                          style={cellInput}
                          value={r.category}
                          onChange={(e) => patch(i, { category: e.target.value })}
                        >
                          <option value="">Automático</option>
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="field-input"
                          style={cellInput}
                          value={r.type}
                          onChange={(e) =>
                            patch(i, { type: e.target.value as 'essencial' | 'nao-essencial' })
                          }
                        >
                          <option value="essencial">Essencial</option>
                          <option value="nao-essencial">Não-essencial</option>
                        </select>
                      </td>
                      <td style={{ color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                        {KIND_LABEL[r.kind]}
                        {r.duplicate && ' · possível duplicata'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="button-primary"
              style={{ marginTop: 12 }}
              disabled={confirming || checkedCount === 0}
              onClick={confirm}
            >
              {confirming ? 'Importando…' : `Importar ${checkedCount} selecionado(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
