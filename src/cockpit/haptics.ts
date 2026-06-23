// Optional haptic feedback. Progressive enhancement only — graceful no-op where
// the Vibration API is unavailable (notably iOS Safari). Never the sole signal.
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* vibration unsupported */
  }
}
