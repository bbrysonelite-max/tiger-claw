import { test, expect } from '@playwright/test';

// Mock all API calls — no live API server required for E2E tests.
// The wizard frontend calls http://localhost:4000 (NEXT_PUBLIC_API_URL default).

test.describe('BYOK Onboarding Flow', () => {

    test.beforeEach(async ({ page }) => {
        // POST /subscriptions/register — called at end of Step 2 (Bot Identity)
        await page.route('**/subscriptions/register', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ userId: 'test-user-id', botId: 'test-bot-id' }),
            });
        });

        // POST /wizard/validate-key — called when user clicks "Validate Key →" in Step 3
        await page.route('**/wizard/validate-key', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ valid: true }),
            });
        });

        // POST /subscriptions/checkout — called when user clicks "Pay & Launch Agent" in Step 4
        await page.route('**/subscriptions/checkout', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ url: 'http://localhost:3000/success?session_id=test_session_123' }),
            });
        });

        // GET /wizard/status — polled by PostPaymentSuccess after Stripe redirect
        await page.route('**/wizard/status**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    status: 'live',
                    botUsername: 'test_claw_bot',
                    telegramLink: 'https://t.me/test_claw_bot',
                    tenantSlug: 'test-slug-123',
                }),
            });
        });
    });

    test('completes the full BYOK onboarding wizard', async ({ page }) => {
        // 1. Visit Landing Page
        await page.goto('/');
        await expect(page).toHaveTitle(/Tiger Claw/);

        // 2. Open Wizard
        await page.getByRole('button', { name: 'Launch My Agent' }).click();

        // Modal header shows step progress
        await expect(page.getByText('Agent Setup')).toBeVisible();
        await expect(page.getByText('Step 1 of 4')).toBeVisible();

        // 3. Step 1: Niche Picker
        await expect(page.getByText('Select Your Industry')).toBeVisible();
        await page.getByRole('button', { name: 'Network Marketing' }).click();
        await page.getByRole('button', { name: 'Continue' }).click();

        // 4. Step 2: Bot Identity
        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        await expect(page.getByText('Bot Identity')).toBeVisible();
        await page.getByPlaceholder('e.g. John Doe').fill('Brent Bryson');
        await page.getByPlaceholder('you@example.com').fill('brent@test.com');
        // Bot name is pre-filled from niche — "Prospect Scout" for network-marketer
        await expect(page.getByPlaceholder('e.g. Prospect Scout')).toHaveValue('Prospect Scout');
        await page.getByRole('button', { name: 'Continue' }).click();

        // 5. Step 3: AI Connection (BYOK — locked, no option to select)
        await expect(page.getByText('Step 3 of 4')).toBeVisible();
        await expect(page.getByText('Connect Your AI Engine')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Bring Your Own Key (BYOK)' })).toBeVisible();

        // Enter Google API key (must be > 5 chars to show validate button)
        const keyInput = page.getByPlaceholder('AIza...');
        await keyInput.fill('AIzaTestKeyMockedForE2ETesting', { force: true });

        // Validate button appears after key is entered
        await page.getByRole('button', { name: 'Validate Key →' }).click();

        // Success message appears after validation
        await expect(page.getByText('Key validated — encrypted and stored securely')).toBeVisible();

        // Continue is now enabled
        await page.getByRole('button', { name: 'Continue' }).click();

        // 6. Step 4: Review & Pay
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
        await expect(page.getByText('Review & Pay')).toBeVisible();
        await expect(page.getByText('Prospect Scout')).toBeVisible();
        await expect(page.getByText('Network Marketing Persona')).toBeVisible();
        await expect(page.getByText('✓ Validated & Encrypted')).toBeVisible();
        await expect(page.getByText('Google Gemini (gemini-2.5-flash)')).toBeVisible();
        await expect(page.getByText('Telegram (auto-provisioned)')).toBeVisible();
        await expect(page.getByText('Brent Bryson')).toBeVisible();
        await expect(page.getByText('$47.00')).toBeVisible();

        // 7. Launch → triggers Stripe redirect to /success
        await page.getByRole('button', { name: /Pay & Launch Agent/ }).click();

        // 8. PostPaymentSuccess page
        await page.waitForURL('**/success**');
        // Note: "Provisioning..." is transient — mock resolves to "live" on first poll,
        // so the deploying state may already be gone by the time the assertion runs.
        // Assert the terminal success state instead:
        // Status poll returns "live" on first poll — allow time for page hydration
        await expect(page.getByText('Agent Deployed')).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('Status: LIVE')).toBeVisible();
        await expect(page.getByText('@test_claw_bot')).toBeVisible();
        await expect(page.getByRole('link', { name: /Open Telegram/ })).toBeVisible();
    });

    test('shows error state when key validation fails', async ({ page }) => {
        // Override the validate-key mock to return invalid
        await page.route('**/wizard/validate-key', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ valid: false, error: 'Invalid API key — check your Google AI Studio key.' }),
            });
        });

        await page.goto('/');
        await page.getByRole('button', { name: 'Launch My Agent' }).click();

        // Step 1
        await page.getByRole('button', { name: 'Network Marketing' }).click();
        await page.getByRole('button', { name: 'Continue' }).click();

        // Step 2
        await page.getByPlaceholder('e.g. John Doe').fill('Test User');
        await page.getByPlaceholder('you@example.com').fill('test@test.com');
        await page.getByRole('button', { name: 'Continue' }).click();

        // Step 3: enter key and attempt validation
        await page.getByPlaceholder('AIza...').fill('AIzaBadKeyForTesting', { force: true });
        await page.getByRole('button', { name: 'Validate Key →' }).click();

        // Error message shown, Continue stays disabled
        await expect(page.getByText('Invalid API key — check your Google AI Studio key.')).toBeVisible();

        // Continue button should not be present / enabled (canProceed = false)
        const continueButton = page.getByRole('button', { name: 'Continue' });
        await expect(continueButton).toBeDisabled();
    });

    test('shows checkout error when payment server fails', async ({ page }) => {
        // Override checkout mock to return an error
        await page.route('**/subscriptions/checkout', async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'failed_to_create_checkout' }),
            });
        });

        await page.goto('/');
        await page.getByRole('button', { name: 'Launch My Agent' }).click();

        // Step 1
        await page.getByRole('button', { name: 'Network Marketing' }).click();
        await page.getByRole('button', { name: 'Continue' }).click();

        // Step 2
        await page.getByPlaceholder('e.g. John Doe').fill('Test User');
        await page.getByPlaceholder('you@example.com').fill('test@test.com');
        await page.getByRole('button', { name: 'Continue' }).click();

        // Step 3: validate key
        await page.getByPlaceholder('AIza...').fill('AIzaValidKeyForTesting', { force: true });
        await page.getByRole('button', { name: 'Validate Key →' }).click();
        await expect(page.getByText('Key validated — encrypted and stored securely')).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();

        // Step 4: attempt checkout — server returns error
        await page.getByRole('button', { name: /Pay & Launch Agent/ }).click();

        // Error message shown — button NOT locked (onLaunch not called when url is absent)
        await expect(page.getByText('failed_to_create_checkout')).toBeVisible();

        // Button should still be clickable (isDeploying stays false on error)
        await expect(page.getByRole('button', { name: /Pay & Launch Agent/ })).not.toBeDisabled();
    });

});
