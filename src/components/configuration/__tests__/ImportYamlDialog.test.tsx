import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseImportedYaml } from '@/server';
import { ImportYamlDialog } from '../ImportYamlDialog';

vi.mock('@/hooks/useLocalize', () => {
  const localize = (key: string, options?: Record<string, string | number>) =>
    options ? `${key} ${Object.values(options).join(' ')}` : key;
  return { default: () => localize, useLocalize: () => localize };
});

vi.mock('@/server', () => ({
  parseImportedYaml: vi.fn(),
  createRoleFn: vi.fn(),
  createGroupFn: vi.fn(),
  availableScopesOptions: {
    queryKey: ['availableScopes'],
    queryFn: async () => [],
  },
}));

interface MockChildrenProps {
  children?: React.ReactNode;
}
interface MockDialogProps extends MockChildrenProps {
  open?: boolean;
}
interface MockDialogContentProps extends MockChildrenProps {
  title?: string;
}
interface MockButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}
interface MockAlertProps {
  text: string;
}

vi.mock('@clickhouse/click-ui', () => {
  const Dialog = ({ open, children }: MockDialogProps) => (open ? <div>{children}</div> : null);
  Dialog.Content = ({ title, children }: MockDialogContentProps) => (
    <div>
      {title}
      {children}
    </div>
  );
  const Tabs = ({ children }: MockChildrenProps) => <div>{children}</div>;
  Tabs.TriggersList = ({ children }: MockChildrenProps) => <div>{children}</div>;
  Tabs.Trigger = ({ children }: MockChildrenProps) => <button type="button">{children}</button>;
  Tabs.Content = ({ children }: MockChildrenProps) => <div>{children}</div>;
  return {
    Dialog,
    Tabs,
    Icon: ({ name }: { name: string }) => <span>{name}</span>,
    Alert: ({ text }: MockAlertProps) => <div role="status">{text}</div>,
    Button: ({ label, onClick, disabled }: MockButtonProps) => (
      <button onClick={onClick} disabled={disabled}>
        {label}
      </button>
    ),
  };
});

const parseImportedYamlMock = vi.mocked(parseImportedYaml);

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ImportYamlDialog
        open
        onClose={vi.fn()}
        onImport={vi.fn()}
        onImportAsProfile={vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  );
}

async function validateYaml() {
  fireEvent.change(screen.getByLabelText('com_config_import_paste'), {
    target: { value: 'version: 1.3.12' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'com_config_import_validate' }));
  await screen.findByRole('radiogroup');
}

describe('ImportYamlDialog preserved values notice', () => {
  beforeEach(() => {
    parseImportedYamlMock.mockReset();
  });

  it('shows a non-blocking notice listing values the panel does not recognize', async () => {
    parseImportedYamlMock.mockResolvedValue({
      success: true,
      error: undefined,
      validationErrors: undefined,
      preservedValues: [
        { path: 'endpoints.agents.capabilities.4', value: 'subagents' },
        { path: 'endpoints.agents.capabilities.7', value: 'skills' },
      ],
      appConfig: { version: '1.3.12' },
    });

    renderDialog();
    await validateYaml();

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('com_config_import_preserved_notice 2 subagents, skills');
    expect(screen.getByRole('button', { name: 'com_config_import_apply' })).not.toBeDisabled();
  });

  it('shows no notice when every value is recognized', async () => {
    parseImportedYamlMock.mockResolvedValue({
      success: true,
      error: undefined,
      validationErrors: undefined,
      preservedValues: undefined,
      appConfig: { version: '1.3.12' },
    });

    renderDialog();
    await validateYaml();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
