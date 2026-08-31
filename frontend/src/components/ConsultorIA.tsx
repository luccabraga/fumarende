import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';
import { Markdown } from '../lib/markdown.js';

const h2Style = { fontFamily: 'var(--mono)', fontSize: 15, marginBottom: 10 } as const;

const PRESETS: readonly [api.AiAnalysis['kind'], string][] = [
  ['diagnostico', 'Diagnóstico geral'],
  ['poupanca', 'Estou poupando o suficiente?'],
  ['cambio', 'Converter dólares agora?'],
];

const KIND_LABEL: Record<api.AiAnalysis['kind'], string> = {
  diagnostico: 'Diagnóstico geral',
  poupanca: 'Poupança',
  cambio: 'Câmbio',
};

function brl(usdCents: number, rate: number): string {
  return formatCentsBRL(Math.round(usdCents * rate));
}

export function ConsultorIA() {
  const [status, setStatus] = useState<api.AiStatus | null>(null);
  const [history, setHistory] = useState<api.AiAnalysis[]>([]);
  const [latest, setLatest] = useState<api.AiAnalysis | null>(null);
  const [pending, setPending] = useState<api.AiAnalysis['kind'] | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [webSearch, setWebSearch] = useState(false);

  useEffect(() => {
    Promise.all([api.getAiStatus(), api.listAiAnalyses()])
      .then(([s, h]) => {
        setStatus(s);
        setHistory(h);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Erro ao carregar a IA'));
  }, []);

  async function run(kind: api.AiAnalysis['kind']) {
    setPending(kind);
    setWarn(null);
    try {
      const row = await api.runAiAnalysis(kind, kind === 'cambio' ? webSearch : false);
      setLatest(row);
      setHistory((h) => [row, ...h]);
      setStatus((s) =>
        s ? { ...s, monthToDateUsdCents: s.monthToDateUsdCents + row.costUsdCents } : s,
      );
    } catch (err) {
      const s = (err as { status?: number }).status;
      setWarn(
        s === 429
          ? 'Limite mensal de IA atingido.'
          : 'Falha ao consultar a IA. Tente novamente.',
      );
    } finally {
      setPending(null);
    }
  }

  const configured = status?.configured ?? false;

  return (
    <div className="card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <h2 style={h2Style}>Consultor IA</h2>
        {status && (
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            IA este mês: {brl(status.monthToDateUsdCents, status.usdBrlRate)} /{' '}
            {brl(status.capUsdCents, status.usdBrlRate)}
          </span>
        )}
      </div>

      {loadError && <p className="error-text" style={{ marginBottom: 10 }}>{loadError}</p>}

      {!configured && (
        <p style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic', marginBottom: 10 }}>
          Configure <code>ANTHROPIC_API_KEY</code> no servidor para habilitar.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {PRESETS.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className="button-primary"
            disabled={!configured || pending !== null}
            onClick={() => run(kind)}
          >
            {pending === kind ? 'Consultando…' : label}
          </button>
        ))}
      </div>

      {status?.webSearch && (
        <label style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
          <input
            type="checkbox"
            aria-label="com contexto de mercado"
            checked={webSearch}
            onChange={(e) => setWebSearch(e.target.checked)}
            disabled={!configured || pending !== null}
          />{' '}
          com contexto de mercado (web) — usa busca na web no “Converter dólares agora?”, custa um
          pouco mais
        </label>
      )}

      {warn && (
        <p style={{ fontSize: 12.5, color: 'var(--red, var(--text))', marginTop: 10 }}>{warn}</p>
      )}

      {latest && (
        <div style={{ marginTop: 14, fontSize: 13 }}>
          <Markdown source={latest.responseMd} />
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 12.5,
              color: 'var(--text2)',
              cursor: 'pointer',
            }}
          >
            {showHistory ? '▾' : '▸'} Histórico ({history.length})
          </button>
          {showHistory && (
            <div style={{ marginTop: 10 }}>
              {history.map((h) => (
                <div
                  key={h.id}
                  style={{
                    borderTop: '1px solid var(--border)',
                    padding: '10px 0',
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ color: 'var(--text3)', marginBottom: 4 }}>
                    {KIND_LABEL[h.kind]} · {new Date(h.createdAt).toLocaleDateString('pt-BR')} ·{' '}
                    {formatCentsBRL(Math.round(h.costUsdCents * (status?.usdBrlRate ?? 0)))}
                  </div>
                  <Markdown source={h.responseMd} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
