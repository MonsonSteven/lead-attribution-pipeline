// Phone normalization. Canonical phone is E.164 so every consumer (CRM write, Instacall) gets a
// ready-to-use number without re-formatting. US/CA numbers only (the company's world).

/** Normalize a US phone to E.164 (+1XXXXXXXXXX). Returns null if it can't be made into 10 digits. */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null; // not a recognizable US number — caller decides (flag, don't drop)
}

/**
 * True when `input` is a plausibly-valid phone number that is NOT US/CA (NANP) — i.e. `toE164`
 * rejected it, but it's clearly a real international number (e.g. Twilio delivers an overseas caller's
 * `From` in E.164 like `+33100000001`), not empty or garbage. Lets a caller tell an intentionally-
 * dropped out-of-region contact apart from a genuine parse failure (which stays a drift signal).
 * Range 11–15 digits = the E.164 international space above NANP's 10/11.
 */
export function isForeignPhone(input: string | null | undefined): boolean {
  if (!input) return false;
  if (toE164(input) !== null) return false; // it's a US/CA number — not foreign
  const digits = input.replace(/\D/g, '');
  return digits.length >= 11 && digits.length <= 15;
}

/** National format, digits only (e.g. 5551230000) — the key the DNI lookup table uses. */
export function toNationalDigits(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}
