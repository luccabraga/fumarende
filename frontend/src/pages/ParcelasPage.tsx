import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';
import { groupInstallments } from '../lib/expenses.js';
import { useResource } from '../lib/useResource.js';
import { AsyncBoundary } from '../components/AsyncBoundary.js';
import { EmptyState } from '../components/EmptyState.js';
import { useToast } from '../context/ToastContext.js';
import { PageHeader } from '../components/PageHeader.js';

export function ParcelasPage() {
  const r = useResource(() => api.listExpenses(), []);
  const { toast } = useToast();

  async function handleDelete(groupId: string) {
    try {
      await api.deleteExpenseGroup(groupId);
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  const groups = groupInstallments(r.data ?? [], new Date().toISOString().slice(0, 10));

  return (
    <div className="page">
      <PageHeader title="Parcelas" />

      <AsyncBoundary loading={r.loading} error={r.error} onRetry={r.reload}>
        <div className="card">
          {groups.length === 0 && (
            <EmptyState message="Nenhuma compra parcelada." />
          )}
          {groups.map((g) => (
            <div key={g.groupId} className="list-row">
              <span style={{ flex: 1 }}>{g.description}</span>
              <span className="subtle">
                parcela {g.paidCount}/{g.installmentTotal}
              </span>
              <span className="mono">
                restante {formatCentsBRL(g.remainingCents)}
              </span>
              <span className="mono muted">
                total {formatCentsBRL(g.totalCents)}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(g.groupId)}
                aria-label={`Excluir parcelamento ${g.description}`}
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
