import '@/locales/i18n';
import { render } from '@testing-library/react';
import { ClickUIProvider } from '@clickhouse/click-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  createRoute,
} from '@tanstack/react-router';
import type { RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { ThemeProvider } from '@/contexts/ThemeContext';

const APP_PATHS = ['/', '/configuration', '/access', '/grants', '/help'];

export function renderWithLayoutProviders(
  ui: ReactNode,
  { user = null, path = '/' }: t.LayoutRenderOptions = {},
): RenderResult {
  const rootRoute = createRootRoute();
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_app',
    beforeLoad: () => ({ user }),
  });
  const pageRoutes = APP_PATHS.map((pagePath) =>
    createRoute({ getParentRoute: () => appRoute, path: pagePath, component: () => ui }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren(pageRoutes)]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ClickUIProvider theme="light">
          <RouterProvider router={router} />
        </ClickUIProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}
