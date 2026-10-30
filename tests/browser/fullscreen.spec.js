import { test, expect } from '@playwright/test';

test('tablet can enter fullscreen before pairing and recover after exiting', async ({ page }) => {
  await page.goto('/tablet');
  await page.getByRole('button', { name: 'Activar pantalla completa' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect(page.locator('#tablet-fullscreen')).toBeHidden();
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator('#tablet-fullscreen')).toBeVisible();
  await page.locator('#tablet-fullscreen').click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
});

test('unsupported fullscreen shows help instead of silently failing', async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = undefined;
    Element.prototype.webkitRequestFullscreen = undefined;
  });
  await page.goto('/tablet');
  await page.locator('#tablet-fullscreen').click();
  await expect(page.locator('#fullscreen-help')).toContainText('El navegador no permitió');
  await expect(page.locator('#tablet-fullscreen')).toBeVisible();
});
