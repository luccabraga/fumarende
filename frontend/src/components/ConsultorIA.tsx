import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';
import { Markdown } from '../lib/markdown.js';

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
      <h2 className="section-title">Consultor IA</h2>

      {loadError && <p className="error-text">{loadError}</p>}

      {!configured && (
        <p className="subtle" style={{ fontStyle: 'italic', marginBottom: 'var(--space-3)' }}>
          Configure <code>ANTHROPIC_API_KEY</code> no servidor para habilitar.
        </p>
      )}

      <div className="row-sm">
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
        <label className="subtle" style={{ display: 'block', marginTop: 'var(--space-2)' }}>
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
        <p className="error-text" style={{ marginTop: 'var(--space-3)' }}>{warn}</p>
      )}

      {latest && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Markdown source={latest.responseMd} />
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="link-btn"
            aria-expanded={showHistory}
            aria-controls="consultor-history"
          >
            {showHistory ? '▾' : '▸'} Histórico ({history.length})
          </button>
          {showHistory && (
            <div id="consultor-history" className="stack-sm" style={{ marginTop: 'var(--space-3)' }}>
              {history.map((h) => (
                <div
                  key={h.id}
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 'var(--space-3)',
                  }}
                >
                  <div className="subtle">
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
