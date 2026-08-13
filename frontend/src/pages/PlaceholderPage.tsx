export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="card">
      <p style={{ fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{title} — em breve</p>
    </div>
  );
}
