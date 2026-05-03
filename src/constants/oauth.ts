import type * as t from '@/types';

/**
 * Registry of OAuth providers the admin panel knows how to surface.
 *
 * Adding a new provider that LibreChat already supports (e.g. github, discord)
 * is a matter of appending an entry here, adding a callback route file at
 * `src/routes/auth/<id>/callback.tsx`, and adding the matching i18n key.
 */
export const OAUTH_PROVIDERS: ReadonlyArray<t.OAuthProviderDef> = [
  {
    id: 'openid',
    startPath: '/api/admin/oauth/openid',
    callbackRoute: '/auth/openid/callback',
    defaultLabelKey: 'com_auth_provider_openid',
    enabledKey: 'openidLoginEnabled',
    labelKey: 'openidLabel',
    imageKey: 'openidImageUrl',
  },
  {
    id: 'google',
    startPath: '/api/admin/oauth/google',
    callbackRoute: '/auth/google/callback',
    defaultLabelKey: 'com_auth_provider_google',
    logo: 'google',
    enabledKey: 'googleLoginEnabled',
  },
];
