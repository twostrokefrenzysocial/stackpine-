/**
 * Shared-secret authentication between the Optimus app and the proxy.
 */

const encoder = new TextEncoder();

/**
 * Compares two strings in time that depends only on their lengths, not on
 * where they first differ, so the secret can't be recovered byte-by-byte by
 * timing responses.
 *
 * Length is not secret here (APP_TOKEN has a fixed, documented format), but
 * we still iterate over the longer input so that a short guess does not
 * return measurably faster.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const len = Math.max(x.length, y.length);

  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) {
    // Out-of-range reads yield undefined; `| 0` maps them to 0.
    diff |= (x[i] | 0) ^ (y[i] | 0);
  }
  return diff === 0;
}

/**
 * True when `provided` matches the configured token. An unset or empty
 * expected token never authenticates anything.
 */
export function isAuthorized(provided: string | null, expected: string | undefined): boolean {
  if (!expected || provided === null) return false;
  return timingSafeEqual(provided, expected);
}
