export const MISSING_PKCE_VERIFIER_MESSAGE =
  'SSO session state was lost before the callback. For HTTP deployments, set SESSION_COOKIE_SECURE=false on the admin panel so the admin-session cookie is accepted.';

type OAuthExchangePayloadResult =
  | {
      ok: true;
      body: string;
    }
  | {
      ok: false;
      message: string;
    };

export function buildOAuthExchangePayload(
  code: string,
  codeVerifier: unknown,
): OAuthExchangePayloadResult {
  if (typeof codeVerifier !== 'string' || codeVerifier.length === 0) {
    return {
      ok: false,
      message: MISSING_PKCE_VERIFIER_MESSAGE,
    };
  }

  return {
    ok: true,
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  };
}
