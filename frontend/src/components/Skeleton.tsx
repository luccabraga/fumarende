export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      <div className="skeleton__bar" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton__block" />
      ))}
    </div>
  );
}
