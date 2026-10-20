export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <rect x="1.25" y="1.25" width="13.5" height="13.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="7.5" y="3.5" width="1" height="9" fill="currentColor" />
    </svg>
  );
}
