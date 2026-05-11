import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { GrantsPage } from '@/components/grants';

type Tab = 'management' | 'audit-log';

interface GrantsSearch {
  tab?: string;
  entryId?: string;
}

function isValidTab(value?: string): value is Tab {
  return value === 'management' || value === 'audit-log';
}

export const Route = createFileRoute('/_app/grants')({
  validateSearch: (search: Record<string, unknown>): GrantsSearch => ({
    tab: typeof search.tab === 'string' ? search.tab : undefined,
    entryId: typeof search.entryId === 'string' ? search.entryId : undefined,
  }),
  component: GrantsRoute,
});

function GrantsRoute() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: '/grants' });
  const activeTab: Tab = isValidTab(tab) ? tab : 'management';

  const handleTabChange = (value: string) => {
    if (isValidTab(value)) {
      navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, tab: value }) });
    }
  };

  return <GrantsPage activeTab={activeTab} onTabChange={handleTabChange} />;
}
