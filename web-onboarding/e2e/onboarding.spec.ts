import { test, expect } from '@playwright/test';

test('completes the BYOK onboarding flow', async ({ page }) => {
    // 1. Visit Landing Page
    await page.goto('/');
    await expect(page).toHaveTitle(/Tiger Claw/);

    // 2. Open Wizard
    await page.getByRole('button', { name: 'Launch My Agent' }).click();
    await expect(page.getByText('Select Your Industry')).toBeVisible();

    // 3. Step 1: Niche Picker
    await page.getByRole('button', { name: 'Network Marketing' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // 4. Step 2: Bot Identity
    await expect(page.getByText('Bot Identity')).toBeVisible();
    await page.getByPlaceholder('e.g. John Doe').fill('Brent Bryson');
    await expect(page.getByPlaceholder('e.g. Prospect Scout')).toHaveValue('Prospect Scout');
    await page.getByRole('button', { name: 'Continue' }).click();

    // 5. Step 3: AI Connection (Select BYOK path for test)
    await expect(page.getByText('AI Engine Connection')).toBeVisible();
    await page.getByRole('button', { name: 'Bring Your Own Key' }).click();

    // Test OpenAI validation UI formatting
    const keyInput = page.getByPlaceholder('e.g. sk-');
    await keyInput.fill('sk-invalidKeyThatIsTooLongToTriggerPatternMatchDemo');
    await expect(page.getByText('Format doesn\'t match expected pattern')).toBeVisible();

    // Switch back to Tiger Credits for faster checkout mock
    await page.getByRole('button', { name: 'Tiger Claw Credits' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // 6. Step 4: Review Payment
    await expect(page.getByText('Review & Deploy')).toBeVisible();
    await expect(page.getByText('Prospect Scout')).toBeVisible();
    await expect(page.getByText('Network Marketing Persona')).toBeVisible();

    // 7. Mock Deployment (2s timeout)
    await page.getByRole('button', { name: /Pay & Launch Agent/ }).click();

    // 8. Expect Post Payment Modal after deployment
    await expect(page.getByText('Provisioning...')).toBeVisible();

    // wait 5 seconds (4sec timeout in mock)
    await expect(page.getByText('Agent Deployed')).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole('link', { name: /Open Telegram/ })).toBeVisible();
});
