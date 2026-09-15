/**
 * The mark: three dots — draw, answer, paste — in a triangle, from light to
 * ink. Same shape as app/icon.svg; drawn in currentColor so it follows the
 * theme.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <circle cx="9" cy="10" r="6.5" fill="currentColor" opacity="0.3" />
      <circle cx="23" cy="10" r="6.5" fill="currentColor" opacity="0.55" />
      <circle cx="16" cy="22.5" r="6.5" fill="currentColor" />
    </svg>
  )
}
