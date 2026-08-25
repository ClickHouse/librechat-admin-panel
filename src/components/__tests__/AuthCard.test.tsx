import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as t from '@/types';
import { openidLoginFn } from '@/server';
import { AuthCard } from '../AuthCard';

vi.mock('@/server', () => ({
  adminLoginFn: vi.fn(),
  adminVerify2FAFn: vi.fn(),
  openidLoginFn: vi.fn(),
  openIdCheckOptions: { queryKey: ['openIdCheck'], queryFn: vi.fn() },
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
}));

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

type SsoLoginResult = Awaited<ReturnType<typeof openidLoginFn>>;

const openidLoginFnMock = vi.mocked(openidLoginFn);

function renderAuthCard(props: Partial<t.AuthCardProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthCard ssoAvailable {...props} />
    </QueryClientProvider>,
  );
}

function getSsoButton() {
  return screen.getByRole('button', { name: 'com_auth_sso_sign_in' });
}

function getSsoRedirectingButton() {
  return screen.getByRole('button', { name: 'com_auth_sso_redirecting' });
}

describe('AuthCard SSO login', () => {
  const locationStub = { href: 'http://localhost:3000/' };

  beforeEach(() => {
    locationStub.href = 'http://localhost:3000/';
    vi.stubGlobal('location', locationStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the loading state while the SSO login request is pending', async () => {
    openidLoginFnMock.mockImplementation(() => new Promise<SsoLoginResult>(() => {}));
    renderAuthCard();

    fireEvent.click(getSsoButton());

    await waitFor(() => {
      const button = getSsoRedirectingButton();
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toBeDisabled();
    });
  });

  it('keeps the button loading after resolving and navigates to the auth URL', async () => {
    const authUrl = 'https://idp.example.com/authorize';
    openidLoginFnMock.mockResolvedValue({ error: false, authUrl });
    renderAuthCard();

    fireEvent.click(getSsoButton());

    await waitFor(() => expect(locationStub.href).toBe(authUrl));
    const button = getSsoRedirectingButton();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });

  it('resets the loading state when the page is restored from the back-forward cache', async () => {
    const authUrl = 'https://idp.example.com/authorize';
    openidLoginFnMock.mockResolvedValue({ error: false, authUrl });
    renderAuthCard();

    fireEvent.click(getSsoButton());
    await waitFor(() => expect(locationStub.href).toBe(authUrl));

    fireEvent(window, Object.assign(new Event('pageshow'), { persisted: false }));
    expect(getSsoRedirectingButton()).toBeDisabled();

    fireEvent(window, Object.assign(new Event('pageshow'), { persisted: true }));
    const button = getSsoButton();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).toBeEnabled();
  });

  it('returns the button to non-loading when the request resolves with an error', async () => {
    openidLoginFnMock.mockResolvedValue({ error: true, message: 'Failed to initiate SSO login' });
    renderAuthCard();

    fireEvent.click(getSsoButton());

    await waitFor(() =>
      expect(screen.getByText('Failed to initiate SSO login')).toBeInTheDocument(),
    );
    const button = getSsoButton();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).toBeEnabled();
    expect(locationStub.href).toBe('http://localhost:3000/');
  });

  it('returns the button to non-loading when the request rejects', async () => {
    openidLoginFnMock.mockRejectedValue(new Error('network down'));
    renderAuthCard();

    fireEvent.click(getSsoButton());

    await waitFor(() => expect(screen.getByText('com_auth_unable_connect')).toBeInTheDocument());
    const button = getSsoButton();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).toBeEnabled();
  });
});

describe('AuthCard panel width', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login panel with fillWidth and a min width', () => {
    const { container } = renderAuthCard();

    const panel = container.querySelector<HTMLElement>('.auth-card');
    expect(panel).not.toBeNull();
    expect(panel?.style.getPropertyValue('--panel-width')).toBe('100%');
    expect(panel?.classList.contains('min-w-70')).toBe(true);
    expect(panel?.classList.contains('max-w-md')).toBe(true);
  });

  it('renders the auto-redirect panel with fillWidth and a min width', () => {
    openidLoginFnMock.mockImplementation(() => new Promise<SsoLoginResult>(() => {}));
    const { container } = renderAuthCard({ autoRedirectSso: true });

    const panel = container.querySelector<HTMLElement>('.auth-card');
    expect(panel).not.toBeNull();
    expect(panel?.style.getPropertyValue('--panel-width')).toBe('100%');
    expect(panel?.classList.contains('min-w-70')).toBe(true);
    expect(panel?.classList.contains('max-w-md')).toBe(true);
  });
});
