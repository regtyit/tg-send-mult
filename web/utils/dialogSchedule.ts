/** Human-readable delay range, e.g. "35–80s" or "2m 10s". */
export function formatSecRange(minSec: number, maxSec: number): string {
  const lo = Math.max(0, Math.floor(minSec));
  const hi = Math.max(lo, Math.floor(maxSec));
  if (lo === hi) return formatSec(lo);
  return `${formatSec(lo)}–${formatSec(hi)}`;
}

export function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

export interface DialogTurnTimingInput {
  delaySecMin: number;
  delaySecMax: number;
  waitForText?: string;
}

export interface DialogTurnScheduleRow {
  line: number;
  /** When this line is sent (relative to session Start). */
  when: string;
  pauseBefore: string | null;
  waitForText: string;
}

/**
 * Cumulative schedule for script lines. Line 1 runs on Start; line N waits
 * `delaySecMin`–`delaySecMax` after the previous line was sent (plus optional
 * peer wait — not included in the time range).
 */
export function buildDialogTurnSchedule(turns: DialogTurnTimingInput[]): DialogTurnScheduleRow[] {
  let minAcc = 0;
  let maxAcc = 0;
  return turns.map((t, idx) => {
    const wait = (t.waitForText ?? '').trim();
    if (idx === 0) {
      return {
        line: 1,
        when: 'On Start (line 1)',
        pauseBefore: null,
        waitForText: wait,
      };
    }
    minAcc += Math.max(0, t.delaySecMin);
    maxAcc += Math.max(0, t.delaySecMax);
    const pauseBefore = formatSecRange(t.delaySecMin, t.delaySecMax);
    let when = `~${formatSecRange(minAcc, maxAcc)} after Start (line ${idx + 1})`;
    if (wait) {
      when += ' — after peer reply';
    }
    return {
      line: idx + 1,
      when,
      pauseBefore,
      waitForText: wait,
    };
  });
}

/** Format API `nextRunAt` for the sessions table. */
export function formatNextRunAt(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffSec = Math.round((t - nowMs) / 1000);
  if (diffSec <= -5) return `${formatSec(-diffSec)} ago`;
  if (diffSec < 5) return 'now';
  return `in ${formatSec(diffSec)}`;
}
