import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithLayoutProviders } from '@/test/layout-test-utils';
import { Sidebar } from '../Sidebar';

vi.mock('@/server', async () => {
  const { SystemCapabilities } = await import('@/constants');
  return {
    adminLogoutFn: vi.fn().mockResolvedValue({ error: false, redirect: '' }),
    getEffectiveCapabilitiesFn: vi.fn().mockResolvedValue({
      capabilities: [
        SystemCapabilities.ACCESS_ADMIN,
        SystemCapabilities.READ_CONFIGS,
        SystemCapabilities.READ_ROLES,
      ],
    }),
  };
});

const user = { name: 'Ada Lovelace', email: 'ada@example.com' };

const renderSidebar = (collapsed: boolean, onToggle: () => void = () => {}) =>
  renderWithLayoutProviders(<Sidebar user={user} collapsed={collapsed} onToggle={onToggle} />, {
    user,
  });

describe('Sidebar', () => {
  it('centers the logo, nav icons, and avatar in a fixed-width rail when collapsed', async () => {
    renderSidebar(true);
    const dashboardLink = await screen.findByRole('link', { name: 'Dashboard' });
    expect(dashboardLink).toHaveClass('w-10', 'justify-center', 'gap-0');
    expect(dashboardLink).not.toHaveClass('gap-2.5');
    const logoRow = screen.getByAltText('LibreChat logo').parentElement;
    expect(logoRow).toHaveClass('w-10', 'justify-center', 'gap-0');
    expect(logoRow).not.toHaveClass('w-full');
    const menuButton = screen.getByRole('button', { name: /User menu/ });
    const avatarRow = menuButton.closest('.border-t')?.firstElementChild;
    expect(avatarRow).toHaveClass('w-10', 'justify-center', 'gap-0');
  });

  it('strips aria-expanded from the real dropdown trigger wrapper', async () => {
    renderSidebar(true);
    const menuButton = await screen.findByRole('button', { name: /User menu/ });
    await waitFor(() => expect(menuButton.parentElement).not.toHaveAttribute('aria-expanded'));
  });

  it('renders capability-gated nav items once effective capabilities resolve', async () => {
    renderSidebar(true);
    expect(await screen.findByRole('link', { name: 'Configuration' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Access' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Grants' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
  });

  it('restores gaps and left alignment when expanded', async () => {
    renderSidebar(false);
    const dashboardLink = await screen.findByRole('link', { name: 'Dashboard' });
    expect(dashboardLink).toHaveClass('gap-2.5');
    expect(dashboardLink).not.toHaveClass('justify-center');
    expect(dashboardLink).not.toHaveClass('w-10');
    const logoRow = screen.getByAltText('LibreChat logo').parentElement;
    expect(logoRow).toHaveClass('gap-2.5', 'px-1.5');
    expect(logoRow).not.toHaveClass('justify-center');
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('opens the real user menu with settings and sign out actions', async () => {
    renderSidebar(true);
    const menuButton = await screen.findByRole('button', { name: /User menu/ });
    fireEvent.pointerDown(menuButton, { button: 0, ctrlKey: false });
    fireEvent.click(menuButton);
    expect(await screen.findByText('Sign out')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('applies the inset focus-ring class to the toggle and calls onToggle', async () => {
    const onToggle = vi.fn();
    renderSidebar(true, onToggle);
    const toggle = await screen.findByRole('button', { name: 'Expand sidebar' });
    expect(toggle).toHaveClass('sidebar-toggle');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
