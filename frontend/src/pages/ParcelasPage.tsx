import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';
import { groupInstallments } from '../lib/expenses.js';

export function ParcelasPage() {
  const [expenses, setExpenses] = useState<api.Expense[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setExpenses(await api.listExpenses());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(groupId: string) {
    setError(null);
    try {
      await api.deleteExpenseGroup(groupId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  const groups = groupInstallments(expenses, new Date().toISOString().slice(0, 10));

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Parcelas</h1>

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="card">
        {groups.length === 0 && (
          <p style={{ color: 'var(--text3)' }}>Nenhuma compra parcelada.</p>
        )}
        {groups.map((g) => (
          <div
            key={g.groupId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ flex: 1 }}>{g.description}</span>
            <span style={{ color: 'var(--text2)', fontSize: 12.5 }}>
              parcela {g.paidCount}/{g.installmentTotal}
            </span>
            <span style={{ fontFamily: 'var(--mono)' }}>
              restante {formatCentsBRL(g.remainingCents)}
            </span>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
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
    </div>
  );
}
