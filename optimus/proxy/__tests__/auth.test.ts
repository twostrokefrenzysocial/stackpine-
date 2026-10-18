import { isAuthorized, timingSafeEqual } from '../src/auth';

describe('timingSafeEqual', () => {
  it('matches equal strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('ünï', 'ünï')).toBe(true);
  });

  it('rejects different strings, including prefixes and length mismatches', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abc123')).toBe(false);
    expect(timingSafeEqual('abc123', 'abc')).toBe(false);
    expect(timingSafeEqual('abc', '')).toBe(false);
    // Out-of-range bytes must not compare equal to NUL.
    expect(timingSafeEqual('a', 'a\u0000')).toBe(false);
  });
});

describe('isAuthorized', () => {
  it('never authorizes when no token is configured', () => {
    expect(isAuthorized('', undefined)).toBe(false);
    expect(isAuthorized('', '')).toBe(false);
    expect(isAuthorized(null, 'secret')).toBe(false);
  });

  it('authorizes only the configured token', () => {
    expect(isAuthorized('secret', 'secret')).toBe(true);
    expect(isAuthorized('Secret', 'secret')).toBe(false);
  });
});
