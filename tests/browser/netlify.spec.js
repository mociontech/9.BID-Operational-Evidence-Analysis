import { test, expect } from '@playwright/test';

test('static deployment serves routes and a real seekable video without a relay', async ({ page, context, request }) => {
  const errors = [], requests = [], sockets = [];
  context.on('page', p => {
    p.on('pageerror', error => errors.push(error.message));
    p.on('websocket', socket => sockets.push(socket.url()));
  });
  context.on('request', req => requests.push(new URL(req.url()).pathname));
  for (const path of ['/pantalla', '/control', '/tablet']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('<main id="app">');
  }
  const video = await request.get('/local-video.mp4', { headers: { Range: 'bytes=0-127' } });
  expect(video.status()).toBe(206);
  expect(video.headers()['content-type']).toContain('video/mp4');
  expect((await video.body()).toString()).not.toContain('git-lfs.github.com');

  await page.goto('/');
  const screenPromise = page.waitForEvent('popup');
  await page.locator('#open-screen').click();
  const screen = await screenPromise;
  await expect(screen.locator('#arm')).toBeEnabled();
  await expect(screen.locator('.remote-pairing')).toBeHidden();
  const controlPromise = screen.waitForEvent('popup');
  await screen.locator('#open-local-control').click();
  const control = await controlPromise;
  await screen.locator('#arm').click();
  await expect(control.locator('#tablet-home')).toBeEnabled();
  const invalid = await context.newPage();
  const badLink = new URL(control.url()); badLink.hash = 'token=invalid';
  await invalid.goto(badLink.href);
  await expect(invalid.locator('#tablet-home')).toBeDisabled();
  await control.locator('#tablet-home').click();
  await expect(control.locator('.control-guidance')).toBeVisible();
  await expect(control.locator('.control-guidance')).toBeHidden({ timeout: 8000 });
  await expect(screen.locator('#video')).toHaveJSProperty('paused', false);
  await control.locator('.controller-bg').evaluate(image => { if (image.parentElement.classList.contains('controls-hidden')) image.click(); });
  await control.locator('#play-pause').click();
  await expect(screen.locator('#video')).toHaveJSProperty('paused', true);
  await expect(control.locator('#seek')).toBeEnabled();
  await control.locator('#seek').fill('30');
  await control.locator('#seek').dispatchEvent('change');
  await expect.poll(() => screen.locator('#video').evaluate(v => Math.round(v.currentTime))).toBe(30);
  await expect(control.locator('[data-value="-10"]')).toBeEnabled();
  await control.locator('[data-value="-10"]').click();
  await expect.poll(() => screen.locator('#video').evaluate(v => Math.round(v.currentTime))).toBe(20);
  await expect(control.locator('[data-value="10"]')).toBeEnabled();
  await control.locator('[data-value="10"]').click();
  await expect.poll(() => screen.locator('#video').evaluate(v => Math.round(v.currentTime))).toBe(30);
  await expect(control.locator('[data-action="reboot"]')).toBeEnabled();
  await control.locator('[data-action="reboot"]').click();
  await expect(screen.locator('#video')).toHaveJSProperty('paused', false);
  await expect.poll(() => screen.locator('#video').evaluate(v => v.currentTime)).toBeLessThan(5);
  await control.reload();
  await expect(control.locator('#play-pause')).toBeEnabled();
  await screen.locator('#video').evaluate(v => { v.currentTime = v.duration - 0.2; });
  await expect(control.locator('#tablet-home')).toBeVisible();
  await screen.close();
  await expect(control.locator('#tablet-home')).toBeDisabled();
  await expect(control.locator('#tablet-status')).toContainText('Sin conexión');
  expect(sockets).toEqual([]);
  expect(requests).not.toContain('/api/network');
  expect(requests).not.toContain('/relay');
  expect(errors).toEqual([]);
});
