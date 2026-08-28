import { formatCentsBRL } from '../lib/money.js';

interface BarBreakdownProps {
  rows: { label: string; cents: number }[];
  emptyText: string;
}

export function BarBreakdown({ rows, emptyText }: BarBreakdownProps) {
  if (rows.length === 0) {
    return <p style={{ color: 'var(--text3)' }}>{emptyText}</p>;
  }
  const max = Math.max(...rows.map((r) => r.cents), 0);

  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} style={{ marginBottom: 8 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12.5,
              marginBottom: 3,
            }}
          >
            <span>{r.label}</span>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
              {formatCentsBRL(r.cents)}
            </span>
          </div>
          <div
            style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}
          >
            <div
              data-testid={`bar-${r.label}`}
              style={{
                width: `${max > 0 ? (r.cents / max) * 100 : 0}%`,
                height: '100%',
                background: 'var(--cyan)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
