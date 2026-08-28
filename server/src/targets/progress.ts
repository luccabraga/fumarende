/**
 * Whole months from `today` to `targetDate` (YYYY-MM-DD), on year/month
 * only. Returns null when the date is empty/null or not strictly after
 * today's month. `today` is a parameter only for deterministic tests.
 */
export function monthsUntil(targetDate: string | null, today: Date = new Date()): number | null {
  if (!targetDate) return null;
  const [ty, tm] = targetDate.split('-').map(Number);
  const months = (ty - today.getFullYear()) * 12 + (tm - (today.getMonth() + 1));
  return months > 0 ? months : null;
}

export interface TargetInput {
  targetCents: number;
  currentCents: number;
  targetDate: string | null;
}

export interface TargetProgress {
  remainingCents: number;
  progressPct: number;
  suggestedMonthlyCents: number | null;
  complete: boolean;
}

export function targetProgress(input: TargetInput, today: Date = new Date()): TargetProgress {
  const remainingCents = Math.max(0, input.targetCents - input.currentCents);
  const progressPct =
    input.targetCents > 0 ? Math.min((input.currentCents / input.targetCents) * 100, 100) : 0;
  const complete = input.currentCents >= input.targetCents;

  const months = monthsUntil(input.targetDate, today);
  const suggestedMonthlyCents =
    months !== null && remainingCents > 0 ? Math.round(remainingCents / months) : null;

  return { remainingCents, progressPct, suggestedMonthlyCents, complete };
}
