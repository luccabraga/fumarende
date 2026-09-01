import type { ReactNode } from 'react';
import { Skeleton } from './Skeleton.js';

export function AsyncBoundary({
  loading,
  error,
  onRetry,
  skeletonRows,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  skeletonRows?: number;
  children: ReactNode;
}) {
  if (error) {
    return (
      <div className="card async-error">
        <p className="muted">{error}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Recarregar
        </button>
      </div>
    );
  }
  if (loading) return <Skeleton rows={skeletonRows} />;
  return <>{children}</>;
}
