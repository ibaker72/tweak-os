// The one phone-number implementation in the app.
//
// It exists as its own module because three surfaces need the same answer and
// a fourth needs it in SQL: SMS sending, voice click-to-call, the Settings
// callback field, and private.normalize_phone() in migration 00021. Two of
// those used to carry their own copy of the rules, which is how a number that
// Settings accepted could be one the dialer refused.
//
// Deliberately free of process.env and of any server-only import, so a client
// component can format a number without dragging Twilio configuration into the
// browser bundle.

/**
 * Loose E.164 normalisation. Twilio remains the source of truth for whether a
 * number is dialable; this only rejects what is obviously not a number.
 *
 * Kept byte-for-byte in step with private.normalize_phone() in migration
 * 00021 — the SQL mirror is what actually decides which number gets dialed, so
 * a disagreement between them would let Settings accept something the dialer
 * later refuses.
 *
 *   (862) 298-4988  -> +18622984988
 *   8622984988      -> +18622984988
 *   1-862-298-4988  -> +18622984988
 *   +18622984988    -> +18622984988
 *   +44 20 7946 0958 -> +442079460958
 *   555             -> null
 */
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip everything except digits and a leading +.
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  if (!cleaned) return null;

  if (cleaned.startsWith("+")) {
    return cleaned.length >= 8 ? cleaned : null;
  }

  // No country code — assume US/Canada if 10 digits.
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;
  return null;
}

export function isValidPhoneNumber(raw: string | null | undefined): boolean {
  return normalizePhoneNumber(raw) !== null;
}

/**
 * Stricter than normalizePhoneNumber: the exact shape the
 * agent_profiles_voice_phone_ck constraint allows.
 *
 * normalizePhoneNumber() will happily produce `+0…` from a pasted string, and
 * the column would then reject it with a constraint violation rather than a
 * sentence. This is checked before the write so the user gets the sentence.
 */
export function isStoredE164(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\+[1-9]\d{6,14}$/.test(value);
}

/**
 * Normalise for storage as a callback number, or null when the input is not
 * something we would be willing to dial.
 */
export function normalizeCallbackPhone(raw: string | null | undefined): string | null {
  const normalized = normalizePhoneNumber(raw);
  return normalized !== null && isStoredE164(normalized) ? normalized : null;
}

/**
 * Human-readable form of a stored E.164 number.
 *
 * NANP numbers get the shape people actually read; everything else is returned
 * as-is rather than guessed at, because a wrong grouping on an international
 * number is worse than no grouping.
 */
export function formatPhoneNumber(value: string | null | undefined): string {
  if (!value) return "";
  const e164 = normalizePhoneNumber(value) ?? value.trim();
  const nanp = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (nanp) return `+1 (${nanp[1]}) ${nanp[2]}-${nanp[3]}`;
  return e164;
}

/**
 * Display form that keeps enough digits to recognise the number and hides the
 * rest. Used where a personal callback number sits next to prospect data — the
 * agent needs to confirm it is theirs, not to read it out.
 */
export function maskPhoneNumber(value: string | null | undefined): string {
  if (!value) return "";
  const e164 = normalizePhoneNumber(value) ?? value.trim();
  const nanp = /^\+1(\d{3})\d{3}(\d{4})$/.exec(e164);
  if (nanp) return `+1 (${nanp[1]}) •••-${nanp[2]}`;

  const digits = e164.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `${e164.startsWith("+") ? "+" : ""}${"•".repeat(
    Math.max(digits.length - 4, 0)
  )}${digits.slice(-4)}`;
}
