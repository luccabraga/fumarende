import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';

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
    <div style={{ marginTop: 'var(--space-5)' }}>
      <h2 className="section-title">Uso da IA</h2>

      <div className="card stack-sm">
        {error && <p className="error-text">{error}</p>}

        {usage && (
          <>
            <div>
              Este mês: {brl(usage.monthToDateUsdCents)} / {brl(usage.capUsdCents)}
            </div>

            {usage.byEndpoint.length === 0 ? (
              <p className="subtle">Nenhuma chamada este mês.</p>
            ) : (
              <div>
                {usage.byEndpoint.map((e) => (
                  <div key={e.endpoint} className="list-row" style={{ padding: 'var(--space-1) 0' }}>
                    <span>{label(e.endpoint)}</span>
                    <span className="subtle">{e.calls} chamada(s)</span>
                    <span className="mono">{brl(e.costUsdCents)}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              className="link-btn"
            >
              {showLog ? '▾' : '▸'} Últimas chamadas ({usage.recent.length})
            </button>

            {showLog && (
              <div>
                {usage.recent.length === 0 && (
                  <p className="subtle">Nenhuma chamada ainda.</p>
                )}
                {usage.recent.map((c, i) => (
                  <div
                    key={i}
                    className="subtle"
                    style={{ padding: 'var(--space-1) 0', borderTop: '1px solid var(--border)' }}
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
