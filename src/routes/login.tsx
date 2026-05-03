import { Container } from '@clickhouse/click-ui';
import { createFileRoute } from '@tanstack/react-router';
import ThemeSelector from '@/components/ThemeSelector';
import { AuthCard } from '@/components/AuthCard';
import { getStartupConfigFn } from '@/server';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : '/',
  }),
  loader: async () => {
    const { providers, ssoOnly } = await getStartupConfigFn();
    /**
     * Auto-redirect only when ssoOnly is set AND exactly one SSO provider is
     * configured. With multiple providers, render all buttons and let the
     * admin pick — auto-redirecting to a single one would be ambiguous.
     */
    const autoRedirectProvider =
      ssoOnly && providers.length === 1 ? providers[0].id : undefined;
    return { providers, ssoOnly, autoRedirectProvider };
  },
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const { providers, ssoOnly, autoRedirectProvider } = Route.useLoaderData();

  return (
    <Container
      orientation="vertical"
      alignItems="center"
      justifyContent="center"
      style={{ minHeight: '100vh', padding: '1rem', gap: '1rem' }}
    >
      <AuthCard
        redirectTo={redirect}
        providers={providers}
        ssoOnly={ssoOnly}
        autoRedirectProvider={autoRedirectProvider}
      />
      <div className="sm:absolute sm:bottom-0 sm:left-0 sm:m-4">
        <ThemeSelector returnThemeOnly />
      </div>
    </Container>
  );
}
