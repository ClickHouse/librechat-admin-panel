import { describe, expect, it } from 'vitest';
import { buildOAuthExchangePayload, MISSING_PKCE_VERIFIER_MESSAGE } from './oauth';

describe('buildOAuthExchangePayload', () => {
  it('includes the stored PKCE verifier in the exchange body', () => {
    const result = buildOAuthExchangePayload('a'.repeat(64), 'verifier-123');

    expect(result).toEqual({
      ok: true,
      body: JSON.stringify({ code: 'a'.repeat(64), code_verifier: 'verifier-123' }),
    });
  });

  it('returns a targeted error instead of omitting an undefined verifier', () => {
    const result = buildOAuthExchangePayload('a'.repeat(64), undefined);

    expect(result).toEqual({
      ok: false,
      message: MISSING_PKCE_VERIFIER_MESSAGE,
    });
  });

  it('rejects an empty verifier because LibreChat will enforce the stored challenge', () => {
    const result = buildOAuthExchangePayload('a'.repeat(64), '');

    expect(result.ok).toBe(false);
  });
});
