import './styles/loading-skeleton.css';

/** First-load placeholders only; refreshes keep the last successful content. */
export function LoadingSkeleton({ rows = 5, variant = 'list', label = 'Loading content' }: {
  rows?: number; variant?: 'list' | 'details' | 'messages'; label?: string;
}) {
  return <div className={`lc-skeleton lc-skeleton-${variant}`} role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">{Array.from({ length: rows }, (_, i) =>
      <div className="lc-skeleton-row" key={i}>
        {variant !== 'details' && <span className="lc-skeleton-avatar" />}
        <div className="lc-skeleton-copy"><span className="lc-skeleton-title" /><span className="lc-skeleton-line" /></div>
      </div>)}</div>
  </div>;
}
