import type { LogoName } from '@clickhouse/click-ui';

export type FieldErrors = {
  email?: string;
  password?: string;
};

export type AuthStep = 'login' | '2fa';

export type OAuthProvider = 'openid' | 'google';

export interface OAuthProviderDef {
  id: OAuthProvider;
  /** LibreChat path that initiates this provider's OAuth flow. */
  startPath: string;
  /** Admin-panel route that receives the exchange code. */
  callbackRoute: string;
  /** i18n key used as the button label when /api/config does not supply one. */
  defaultLabelKey: string;
  /** click-ui Logo name. Omitted for non-branded providers (e.g. generic OpenID). */
  logo?: LogoName;
  /** /api/config field that signals availability. */
  enabledKey: string;
  /** /api/config field for a deployer-supplied label override. */
  labelKey?: string;
  /** /api/config field for a deployer-supplied image URL. */
  imageKey?: string;
}

export interface ResolvedProvider {
  id: OAuthProvider;
  label?: string;
  imageUrl?: string;
}

export interface AuthCardProps {
  redirectTo?: string;
  providers?: ResolvedProvider[];
  /** When true and at least one SSO provider is configured, hides the password form. */
  ssoOnly?: boolean;
  /** Set only when ssoOnly is true and exactly one SSO provider is configured. */
  autoRedirectProvider?: OAuthProvider;
}
