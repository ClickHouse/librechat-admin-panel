import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function hideTanStackDevtools(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('button[aria-label="Open TanStack Devtools"]')
      ?.style.setProperty('display', 'none');
  });
}

// ---------------------------------------------------------------------------
// Management tab (default)
// ---------------------------------------------------------------------------

test.describe('Grants page - Management tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');
  });

  test('renders page header and management tab', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /system grants/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /management/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /audit log/i })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('management tab is active by default', async ({ page }) => {
    const mgmtTab = page.getByRole('tab', { name: /management/i });
    await expect(mgmtTab).toHaveAttribute('data-state', 'active');
  });

  test('shows all roles and groups even with 0 grants', async ({ page }) => {
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('type filter filters the table - roles only', async ({ page }) => {
    await page.getByRole('button', { name: /^Roles$/i }).click();
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).locator('.badge-role')).toBeVisible();
    }
  });

  test('search filters by name', async ({ page }) => {
    await page.getByRole('searchbox').fill('admin');
    await expect(page.getByText('Admin', { exact: true }).first()).toBeVisible();
  });

  test('click a row opens EditCapabilitiesDialog', async ({ page }) => {
    await hideTanStackDevtools(page);
    const adminRow = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await adminRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
  });

  test('dialog shows principal type badge', async ({ page }) => {
    await hideTanStackDevtools(page);
    const adminRow = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await adminRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('dialog').locator('.badge-role')).toBeVisible();
  });

  test('dialog cancel discards changes', async ({ page }) => {
    await hideTanStackDevtools(page);
    const adminRow = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await adminRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await page.getByRole('dialog').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
  });

  test('add user grant button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add user grant/i })).toBeVisible();
  });

  test('add user grant dialog opens and shows user picker', async ({ page }) => {
    await hideTanStackDevtools(page);
    await page.getByRole('button', { name: /add user grant/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('combobox')).toBeVisible();
    await expect(page.getByRole('listbox')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Audit Log tab
// ---------------------------------------------------------------------------

test.describe('Grants page - Audit Log tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/grants?tab=audit-log');
    await page.waitForLoadState('networkidle');
  });

  test('renders audit log table', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /system grants/i })).toBeVisible();
    const auditTab = page.getByRole('tab', { name: /audit log/i });
    await expect(auditTab).toHaveAttribute('data-state', 'active');
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('shows diverse audit entries across principal types', async ({ page }) => {
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(5);
  });

  test('action type filter shows only granted entries', async ({ page }) => {
    await page.getByRole('button', { name: /^Granted$/i }).click();
    await page.waitForTimeout(300);
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).getByText('Granted')).toBeVisible();
    }
  });

  test('action type filter shows only revoked entries', async ({ page }) => {
    await page.getByRole('button', { name: /^Revoked$/i }).click();
    await page.waitForTimeout(300);
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).getByText('Revoked')).toBeVisible();
    }
  });

  test('search filters by actor/target name', async ({ page }) => {
    await page.getByRole('searchbox').fill('Alice');
    await page.waitForTimeout(300);
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent();
      expect(text?.toLowerCase()).toContain('alice');
    }
  });

  test('export button is present', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export all matching/i });
    await expect(exportBtn).toBeVisible();
  });

  test('empty state when no entries match filters', async ({ page }) => {
    await page.getByRole('searchbox').fill('zzzznonexistent');
    await page.waitForTimeout(500);
    await expect(page.getByText(/no audit log entries found/i)).toBeVisible();
  });

  test('capability column shows human-readable label with raw key', async ({ page }) => {
    const firstCapCell = page.locator('tbody tr').first().locator('td').nth(2);
    await expect(firstCapCell).toBeVisible();
    const text = await firstCapCell.textContent();
    expect(text).toContain(':');
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

test.describe('Grants page - Tab switching', () => {
  test('switching tabs updates URL and content', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');

    const auditTab = page.getByRole('tab', { name: /audit log/i });
    await auditTab.click();
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/tab=audit-log/);
    await expect(page.getByRole('button', { name: /export all matching/i })).toBeVisible();

    const mgmtTab = page.getByRole('tab', { name: /management/i });
    await mgmtTab.click();
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/tab=management/);
    await expect(page.getByRole('button', { name: /add user grant/i })).toBeVisible();
  });

  test('direct URL to audit-log tab works', async ({ page }) => {
    await page.goto('/grants?tab=audit-log');
    await page.waitForLoadState('networkidle');
    const auditTab = page.getByRole('tab', { name: /audit log/i });
    await expect(auditTab).toHaveAttribute('data-state', 'active');
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

test.describe('Grants page accessibility', () => {
  test('management tab has zero WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('table')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('audit log tab has zero WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/grants?tab=audit-log');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('table')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('edit dialog has zero WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');
    await hideTanStackDevtools(page);

    const adminRow = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await adminRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('keyboard: Tab through filters and rows, Enter opens dialog', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');

    const searchBox = page.getByRole('searchbox');
    await searchBox.focus();
    await expect(searchBox).toBeFocused();

    const firstRow = page.locator('tbody tr').first();
    await firstRow.focus();
    await expect(firstRow).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
  });

  test('focus returns to row after dialog close', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');
    await hideTanStackDevtools(page);

    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

    await expect(firstRow).toBeFocused({ timeout: 3000 });
  });

  test('date inputs have associated labels', async ({ page }) => {
    await page.goto('/grants?tab=audit-log');
    await page.waitForLoadState('networkidle');

    const fromInput = page.locator('#audit-date-from');
    await expect(fromInput).toBeVisible();
    const fromLabel = page.locator('label[for="audit-date-from"]');
    await expect(fromLabel).toBeVisible();

    const toInput = page.locator('#audit-date-to');
    await expect(toInput).toBeVisible();
    const toLabel = page.locator('label[for="audit-date-to"]');
    await expect(toLabel).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Capability enforcement
// ---------------------------------------------------------------------------

test.describe('Grants page enforcement', () => {
  test('sidebar shows Grants link for admin user', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: /grants/i })).toBeVisible();
  });

  test('grants page is accessible with full grants', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Access Denied/i)).not.toBeVisible();
  });
});
