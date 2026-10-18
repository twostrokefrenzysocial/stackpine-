/**
 * One-time passcode redaction, applied before any notification is stored.
 * The Android listener applies the same rules natively
 * (modules/optimus-android/.../OtpRedactor.kt); this copy re-applies them in
 * JS as defense in depth. Keep the two in sync.
 *
 * 1. Always: Google-style codes ("G-123456").
 * 2. Only when a keyword (code, otp, verification, pin, ...) appears in title + text:
 *    a. standalone 4-8 digit runs, or two 2-4 digit groups split by one space/dash;
 *    b. standalone 6-8 char alphanumeric tokens with >= 2 digits and >= 1 letter.
 */

export const CODE_PLACEHOLDER = '[code hidden]';

const KEYWORD =
  /(?<![a-z0-9])(?:codes?|otp|passcodes?|verification|verify|one-time|one time|2fa|two-factor|two factor|security code|login code|sign-in code|pins?|confirmation code|authentication)(?![a-z0-9])/i;
const GOOGLE_CODE = /(?<![A-Za-z0-9])G-\d{4,8}(?![A-Za-z0-9])/g;
const DIGIT_CODE = /(?<![A-Za-z0-9])(?:\d{2,4}[ -]\d{2,4}|\d{4,8})(?![A-Za-z0-9])/g;
const ALNUM_CODE = /(?<![A-Za-z0-9])(?=(?:[A-Za-z]*[0-9]){2})(?=[0-9]*[A-Za-z])[A-Za-z0-9]{6,8}(?![A-Za-z0-9])/g;

export function redactNotification(title: string, text: string): { title: string; text: string; redacted: boolean } {
  const keyword = KEYWORD.test(`${title}\n${text}`);
  const rules = keyword ? [GOOGLE_CODE, DIGIT_CODE, ALNUM_CODE] : [GOOGLE_CODE];
  const apply = (input: string) => rules.reduce((out, re) => out.replace(re, CODE_PLACEHOLDER), input);
  const t = apply(title);
  const x = apply(text);
  return { title: t, text: x, redacted: t !== title || x !== text };
}
