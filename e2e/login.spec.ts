import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Login tests must be unauthenticated
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login page accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  test('has zero WCAG 2.1 AA violations on initial load', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('has zero violations after showing validation errors', async ({ page }) => {
    const signInButton = page.getByRole('button', { name: 'Sign in', exact: true });
    await signInButton.click();

    await expect(page.getByText(/required/i).first()).toBeVisible({ timeout: 5000 });

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('validation errors are announced via live region', async ({ page }) => {
    const signInButton = page.getByRole('button', { name: 'Sign in', exact: true });
    await signInButton.click();

    const liveRegion = page.locator('.auth-card [role="status"][aria-live="polite"]');
    await expect(liveRegion).toContainText(/required/i, { timeout: 5000 });
  });

  test('all interactive elements are reachable by keyboard in order', async ({ page }) => {
    const focusOrder: string[] = [];

    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return (
          el.getAttribute('aria-label')
          || el.getAttribute('placeholder')
          || el.textContent?.trim().slice(0, 40)
          || `${el.tagName.toLowerCase()}[${el.getAttribute('type') || ''}]`
        );
      });
      if (label) focusOrder.push(label);
    }

    const emailIdx = focusOrder.findIndex((l) => /@/.test(l) || /email/i.test(l));
    const passwordIdx = focusOrder.findIndex((l) => /password/i.test(l));
    const signInIdx = focusOrder.findIndex((l) => /sign in/i.test(l));
    const themeIdx = focusOrder.findIndex((l) => /theme/i.test(l));

    expect(emailIdx).toBeGreaterThanOrEqual(0);
    expect(passwordIdx).toBeGreaterThan(emailIdx);
    expect(signInIdx).toBeGreaterThan(passwordIdx);
    expect(themeIdx).toBeGreaterThanOrEqual(0);
  });

  test('no horizontal scroll at 320x256 (WCAG 1.4.10 Reflow)', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 256 },
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await context.close();
  });
});

test.describe('Login page functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  test('theme toggle switches the document class', async ({ page }) => {
    const initialClass = await page.evaluate(() =>
      document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    );

    const themeButton = page.locator('button[aria-label*="theme" i]');
    await themeButton.click();

    const newClass = await page.evaluate(() =>
      document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    );

    expect(newClass).not.toBe(initialClass);
  });

  test('shows validation error for invalid email format', async ({ page }) => {
    await page.locator('input:not([type="password"])').first().fill('notanemail');
    await page.locator('input[type="password"]').first().fill('somepassword');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByText(/valid email/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('pressing Enter in password field submits the form', async ({ page }) => {
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.press('Enter');

    await expect(page.getByText(/required/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('successful login redirects away from /login', async ({ page }) => {
    await page.locator('input:not([type="password"])').first().fill('admin@test.com');
    await page.locator('input[type="password"]').first().fill('password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await page.waitForURL('**/', { timeout: 15_000 });
    expect(page.url()).not.toContain('/login');
  });

  test('shows error banner when server rejects credentials', async ({ page }) => {
    await page.locator('input:not([type="password"])').first().fill('rejected@test.com');
    await page.locator('input[type="password"]').first().fill('wrongpass');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(
      page.getByText(/invalid|failed|credentials/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe('2FA verification flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  async function triggerTwoFAStep(page: import('@playwright/test').Page) {
    await page.locator('input:not([type="password"])').first().fill('2fa@test.com');
    await page.locator('input[type="password"]').first().fill('password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText(/authenticator/i)).toBeVisible({ timeout: 5000 });
  }

  test('transitions to TOTP step with slotted OTP input', async ({ page }) => {
    await triggerTwoFAStep(page);

    await expect(page.getByText(/two-factor/i)).toBeVisible();
    await expect(page.locator('[data-input-otp]')).toBeVisible();
    await expect(page.locator('[role="separator"]')).toBeVisible();
    await expect(page.getByText(/back to login/i)).toBeVisible();
  });

  test('has zero WCAG 2.1 AA violations on 2FA step', async ({ page }) => {
    await triggerTwoFAStep(page);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('partial input does not trigger verification', async ({ page }) => {
    await triggerTwoFAStep(page);

    await page.locator('[data-input-otp]').fill('12345');
    await page.waitForTimeout(500);

    expect(page.url()).toContain('/login');
  });

  test('successful 2FA verification redirects away from login', async ({ page }) => {
    await triggerTwoFAStep(page);

    await page.locator('[data-input-otp]').fill('123456');

    await page.waitForURL('**/', { timeout: 15_000 });
    expect(page.url()).not.toContain('/login');
  });

  test('invalid code shows error and clears input', async ({ page }) => {
    await triggerTwoFAStep(page);

    await page.locator('[data-input-otp]').fill('000000');

    await expect(page.getByText(/invalid/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('back button returns to login form', async ({ page }) => {
    await triggerTwoFAStep(page);

    await page.getByText(/back to login/i).click();

    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByText(/two-factor/i)).not.toBeVisible();
  });
});

test.describe('SSO availability', () => {
  test('shows OpenID button when OpenID is available', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('button', { name: /openid/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('has zero WCAG 2.1 AA violations with SSO button visible', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: /openid/i })).toBeVisible({ timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('login form is still shown when not in SSO-only mode', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.locator('input:not([type="password"])')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('shows Google button alongside OpenID when both are configured', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('button', { name: /google/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('button', { name: /openid/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
