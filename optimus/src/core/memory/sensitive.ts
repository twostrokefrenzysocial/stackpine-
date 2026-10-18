/**
 * Guards for what memory may hold.
 * - Forbidden: secrets that must never be stored (passwords, card/account/ID numbers).
 * - Sensitive: allowed only after the user explicitly agrees (health, finances).
 */

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export type ForbiddenKind = 'password' | 'card-number' | 'account-number' | 'id-number' | 'pin';

export function findForbidden(text: string): ForbiddenKind | null {
  const t = text.toLowerCase();

  if (/\b(password|passcode|passwd|pwd)\b\s*(is|:|=|was)\s*\S+/.test(t)) return 'password';
  if (/\b(pin|pin code|pin number)\b\s*(is|:|=)\s*\d{3,8}\b/.test(t)) return 'pin';

  // Payment cards: 13-19 digits, optionally grouped by spaces or dashes, Luhn-valid.
  for (const m of text.matchAll(/\b(?:\d[ -]?){12,18}\d\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return 'card-number';
  }

  // US SSN / ITIN shapes.
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) return 'id-number';
  if (/\b(ssn|social security)\b[^.\n]{0,20}\d{9}\b/.test(t)) return 'id-number';

  // Account / routing numbers near a keyword.
  if (/\b(account|acct|routing|iban|sort code|member)\s*(number|no\.?|#)?\s*(is|:|=)?\s*[a-z]{0,4}\d[\d -]{5,}\d\b/.test(t)) {
    return 'account-number';
  }

  // Government ID numbers near a keyword.
  if (
    /\b(driver'?s? licen[cs]e|license number|passport|national id|id number|tax id|ein|medicare number)\b[^.\n]{0,20}\b(?=[a-z0-9]*\d)[a-z0-9]{6,}\b/.test(
      t,
    )
  ) {
    return 'id-number';
  }

  return null;
}

const SENSITIVE_PATTERNS: [RegExp, 'health' | 'finances'][] = [
  [
    /\b(diagnos\w*|medication|meds|prescription|therapy|therapist|psychiatrist|depress\w*|anxiety|adhd|diabet\w*|cancer|chemo|blood pressure|cholesterol|pregnan\w*|miscarriage|surgery|disorder|illness|disease|allerg\w*|asthma|insulin|hiv|std|sti|rehab|addiction|sober|sobriety|mental health|panic attack|migraine|cholesterol|condition)\b/,
    'health',
  ],
  [
    /\b(salary|income|paycheck|debt|loan|mortgage|credit score|credit card debt|bank balance|net worth|savings|401k|ira|investments?|stocks?|crypto|bankrupt\w*|owe[sd]?|taxes|tax return|bonus|raise of|\$\s?\d[\d,]*k?\b(?=.*\b(make|earn|owe|paid|salary|debt)\b))\b/,
    'finances',
  ],
];

export function sensitiveTopic(text: string): 'health' | 'finances' | null {
  const t = text.toLowerCase();
  for (const [re, kind] of SENSITIVE_PATTERNS) if (re.test(t)) return kind;
  return null;
}
