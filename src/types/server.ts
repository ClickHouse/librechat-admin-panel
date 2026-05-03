import type { TUser } from 'librechat-data-provider';
import type { OAuthProvider, ResolvedProvider } from './auth';

export type SerializableUser = Pick<TUser, 'id' | 'email' | 'name' | 'role'>;

export interface SessionData {
  user?: SerializableUser;
  token?: string;
  refreshToken?: string;
  tokenProvider?: 'librechat' | OAuthProvider;
  lastVerified?: number;
  lastActivity?: number;
  codeVerifier?: string;
}

export interface StartupConfigResponse {
  openidLoginEnabled?: boolean;
  googleLoginEnabled?: boolean;
  githubLoginEnabled?: boolean;
  discordLoginEnabled?: boolean;
  facebookLoginEnabled?: boolean;
  appleLoginEnabled?: boolean;
  samlLoginEnabled?: boolean;
  socialLoginEnabled?: boolean;
  openidLabel?: string;
  openidImageUrl?: string;
  openidAutoRedirect?: boolean;
  samlLabel?: string;
  samlImageUrl?: string;
}

export interface AdminStartupConfig {
  providers: ResolvedProvider[];
  ssoOnly: boolean;
}

export interface AdminLoginResponse {
  token: string;
  user: SerializableUser;
  twoFAPending?: boolean;
  tempToken?: string;
}

export interface TwoFAVerifyResponse {
  token: string;
  user: SerializableUser;
}

export interface OAuthExchangeResponse {
  token: string;
  refreshToken?: string;
  user: SerializableUser;
}
