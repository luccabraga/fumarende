import { formatCentsBRL } from '../lib/money.js';

interface BarBreakdownProps {
  rows: { label: string; cents: number }[];
  emptyText: string;
}

export function BarBreakdown({ rows, emptyText }: BarBreakdownProps) {
  if (rows.length === 0) {
    return <p className="subtle">{emptyText}</p>;
  }
  const max = Math.max(...rows.map((r) => r.cents), 0);

  return (
    <div className="stack-sm">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="dash-goal-head">
            <span>{r.label}</span>
            <span className="mono muted">{formatCentsBRL(r.cents)}</span>
          </div>
          <div className="dash-goal-track">
            <div
              data-testid={`bar-${r.label}`}
              className="dash-goal-fill"
              style={{ width: `${max > 0 ? (r.cents / max) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
