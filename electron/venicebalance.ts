// Whether there is money behind her voice.
//
// Her conversation runs on a hosted model, paid for up front. On 2026-09-06
// the account ran dry mid-evening and nothing said so: every hosted turn was
// refused, the app fell back to the local model as designed, and what anyone
// would have noticed was her personality going flat. The balance is a number
// Venice will report on request, so it is asked for on the hour and once more
// when a turn is refused for it, and the phone is told when it is low — as a
// system note, not in her voice, because it is not something she would know.

export type Balances = { usd: number; diem: number };

/** The shape Venice returns from GET /api_keys/rate_limits, reduced to the two balances. Null when it is not that shape. */
export function parseBalances(payload: unknown): Balances | null {
  const data = (payload as { data?: { balances?: Record<string, unknown> } } | null)?.data;
  const balances = data?.balances;
  if (!balances || typeof balances !== 'object') return null;
  const usd = Number(balances.USD);
  const diem = Number(balances.DIEM);
  if (!Number.isFinite(usd)) return null;
  return { usd, diem: Number.isFinite(diem) ? diem : 0 };
}

export type BalanceLevel = 'fine' | 'low' | 'empty';

/** Diem is Venice's prepaid unit and spends first; either pool keeps her talking. */
export function balanceLevel(balances: Balances, lowUsd: number): BalanceLevel {
  const total = balances.usd + balances.diem;
  if (total <= 0.01) return 'empty';
  if (total < lowUsd) return 'low';
  return 'fine';
}

export type BalanceWarnings = { level?: BalanceLevel; at?: string };

/**
 * The line for the phone, or null when there is nothing new to say. Said once
 * per level per day: a low balance is worth one note, an empty one another,
 * and a top-up resets the count. `lowUsd` is the threshold in dollars.
 */
export function balanceWarning(balances: Balances, lowUsd: number, previous: BalanceWarnings, now: Date): { line: string; level: BalanceLevel } | null {
  const level = balanceLevel(balances, lowUsd);
  if (level === 'fine') return null;
  const dayMs = 24 * 60 * 60_000;
  const saidRecently = previous.level === level && previous.at && now.getTime() - Date.parse(previous.at) < dayMs;
  if (saidRecently) return null;
  const total = balances.usd + balances.diem;
  const line = level === 'empty'
    ? `Venice is out of credit ($${total.toFixed(2)}). Until it is topped up she is answering from the local model.`
    : `Venice credit is down to $${total.toFixed(2)}. Below zero she falls back to the local model — worth topping up.`;
  return { line, level };
}
