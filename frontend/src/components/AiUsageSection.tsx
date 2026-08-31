import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';

const h2Style = { fontFamily: 'var(--mono)', fontSize: 16, marginBottom: 12 } as const;

const ENDPOINT_LABEL: Record<string, string> = {
  'analysis:diagnostico': 'Diagnóstico',
  'analysis:poupanca': 'Poupança',
  'analysis:cambio': 'Câmbio',
  'analysis:cambio+web': 'Câmbio + web',
  categorize: 'Categorização',
  import: 'Importação',
};
function label(endpoint: string): string {
  return ENDPOINT_LABEL[endpoint] ?? endpoint;
}

export function AiUsageSection() {
  const [usage, setUsage] = useState<api.AiUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    api
      .getAiUsage()
      .then(setUsage)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar o uso da IA'));
  }, []);

  const brl = (usdCents: number) =>
    formatCentsBRL(Math.round(usdCents * (usage?.usdBrlRate ?? 0)));

  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={h2Style}>Uso da IA</h2>

      <div className="card" style={{ fontSize: 13 }}>
        {error && <p className="error-text">{error}</p>}

        {usage && (
          <>
            <div style={{ marginBottom: 10 }}>
              Este mês: {brl(usage.monthToDateUsdCents)} / {brl(usage.capUsdCents)}
            </div>

            {usage.byEndpoint.length === 0 ? (
              <p style={{ color: 'var(--text3)' }}>Nenhuma chamada este mês.</p>
            ) : (
              <div style={{ marginBottom: 10 }}>
                {usage.byEndpoint.map((e) => (
                  <div
                    key={e.endpoint}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '4px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span>{label(e.endpoint)}</span>
                    <span style={{ color: 'var(--text3)' }}>{e.calls} chamada(s)</span>
                    <span style={{ fontFamily: 'var(--mono)' }}>{brl(e.costUsdCents)}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 12.5,
                color: 'var(--text2)',
                cursor: 'pointer',
              }}
            >
              {showLog ? '▾' : '▸'} Últimas chamadas ({usage.recent.length})
            </button>

            {showLog && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                {usage.recent.length === 0 && (
                  <p style={{ color: 'var(--text3)' }}>Nenhuma chamada ainda.</p>
                )}
                {usage.recent.map((c, i) => (
                  <div
                    key={i}
                    style={{ padding: '4px 0', borderTop: '1px solid var(--border)', color: 'var(--text3)' }}
                  >
                    {new Date(c.createdAt).toLocaleDateString('pt-BR')} · {label(c.endpoint)} ·{' '}
                    {c.model} · {c.inputTokens}+{c.outputTokens} tok · {brl(c.costUsdCents)} ·{' '}
                    {c.status === 'ok' ? 'ok' : 'erro'}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
