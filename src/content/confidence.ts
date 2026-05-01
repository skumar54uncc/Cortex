/** Relative-to-batch confidence for search hits (not calibrated probabilities). */

export interface ConfidenceTier {
  label: string;
  cssClass: string;
  relative: number;
}

export function confidenceTier(score: number, maxInBatch: number): ConfidenceTier {
  const max = maxInBatch > 0 && Number.isFinite(maxInBatch) ? maxInBatch : 1;
  const s = Number.isFinite(score) ? score : 0;
  const relative = max > 0 ? s / max : 0;

  if (relative >= 0.88) {
    return { label: "Strong match", cssClass: "cortex-confidence-strong", relative };
  }
  if (relative >= 0.62) {
    return { label: "Good match", cssClass: "cortex-confidence-good", relative };
  }
  return { label: "Looser match", cssClass: "cortex-confidence-possible", relative };
}
