export function LoadingSkeleton({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div className="aih-loading-skeleton" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="aih-skeleton-row" key={index} aria-hidden="true">
          <span className="aih-skeleton-line" style={{ width: `${index % 2 ? 82 : 62}%` }} />
          <span className="aih-skeleton-line is-short" />
        </div>
      ))}
    </div>
  );
}
