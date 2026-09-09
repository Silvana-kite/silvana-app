import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, '../../artifacts/showroom');
const edgePath = process.env.SIILVANA_EDGE_PATH
  ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const baseUrl = process.env.SIILVANA_PREVIEW_URL ?? 'http://127.0.0.1:1420';
const mobileOnly = process.argv.includes('--mobile-only');

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: edgePath,
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});

const results = [];

async function verifyShowroom(name, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && /mistral|three|webgl/i.test(text)) errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && /\/models\/mistral\//i.test(response.url())) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (/\/models\/mistral\//i.test(request.url())) {
      errors.push(`${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`);
    }
  });

  await page.goto(`${baseUrl}/portals`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector('.showroom-loading'), undefined, { timeout: 90_000 });

  const errorMessage = await page.locator('.showroom-error').textContent().catch(() => null);
  if (errorMessage) throw new Error(`${name}: ${errorMessage}`);

  const diagnostics = await page.evaluate(() => {
    const canvas = document.querySelector('.mistral-scene canvas');
    const toolbar = document.querySelector('.showroom-toolbar');
    const identity = document.querySelector('.showroom-identity');
    const monitor = document.querySelector('.environment-monitor');
    const cta = document.querySelector('.portal-main-cta');
    if (!(canvas instanceof HTMLCanvasElement)
      || !(toolbar instanceof HTMLElement)
      || !(identity instanceof HTMLElement)
      || !(monitor instanceof HTMLElement)
      || !(cta instanceof HTMLElement)) {
      throw new Error('Showroom elements are missing');
    }

    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 context is unavailable');
    const sampleWidth = Math.min(canvas.width, 256);
    const sampleHeight = Math.min(canvas.height, 256);
    const startX = Math.max(0, Math.floor((canvas.width - sampleWidth) / 2));
    const startY = Math.max(0, Math.floor((canvas.height - sampleHeight) / 2));
    const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
    gl.readPixels(startX, startY, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const colors = new Set();
    let opaquePixels = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index + 3] > 0) opaquePixels += 1;
      colors.add(`${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}`);
    }

    const toolbarBounds = toolbar.getBoundingClientRect();
    const identityBounds = identity.getBoundingClientRect();
    const monitorBounds = monitor.getBoundingClientRect();
    return {
      canvas: { width: canvas.width, height: canvas.height },
      sampledColors: colors.size,
      opaquePixels,
      toolbarInViewport: toolbarBounds.left >= 0
        && toolbarBounds.right <= window.innerWidth
        && toolbarBounds.top >= 0
        && toolbarBounds.bottom <= window.innerHeight,
      identityOverlapsToolbar: !(identityBounds.right < toolbarBounds.left
        || identityBounds.left > toolbarBounds.right
        || identityBounds.bottom < toolbarBounds.top
        || identityBounds.top > toolbarBounds.bottom),
      monitorOverlapsToolbar: !(monitorBounds.right < toolbarBounds.left
        || monitorBounds.left > toolbarBounds.right
        || monitorBounds.bottom < toolbarBounds.top
        || monitorBounds.top > toolbarBounds.bottom),
    };
  });

  await page.screenshot({ path: resolve(outputDirectory, `${name}.png`), fullPage: true });
  console.log(JSON.stringify({ name, diagnostics, errors }, null, 2));

  if (diagnostics.sampledColors < 8 || diagnostics.opaquePixels === 0) {
    throw new Error(`${name}: Canvas pixel check failed`);
  }
  if (!diagnostics.toolbarInViewport || diagnostics.identityOverlapsToolbar || diagnostics.monitorOverlapsToolbar) {
    throw new Error(`${name}: Showroom controls overlap or leave the viewport`);
  }
  if (errors.length) throw new Error(`${name}: ${errors.join(' | ')}`);

  await page.locator('.portal-control-group button').nth(1).click();
  await page.locator('.portal-view-control button').nth(1).click();
  await page.locator('.portal-mode-panel').waitFor({ state: 'visible' });
  await page.locator('.portal-view-control button').nth(0).click();
  await page.locator('.portal-control-group button').nth(0).click();

  if (width >= 768) {
    await page.locator('.portal-menu-button').click();
    await page.locator('.portal-switcher__menu').waitFor({ state: 'visible' });
    await page.locator('.portal-menu-button').click();
  }

  results.push({ name, ...diagnostics, errors });
  await page.close();
}

try {
  if (!mobileOnly) await verifyShowroom('showroom-desktop', 1440, 900);
  await verifyShowroom('showroom-mobile', 390, 844);

  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  await browser.close();
}
