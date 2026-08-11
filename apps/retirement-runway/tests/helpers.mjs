// Shared plumbing for the e2e suite: spins up `vite preview` against the already-built
// dist/ (run `vite build` first — the `pretest:e2e` npm script does this for you) and
// hands back a Playwright browser pointed at it.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4321;
export const BASE_URL = `http://localhost:${PORT}/calculators/retirement-runway/`;

export async function startPreviewServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
  });
  const ready = new Promise((resolve, reject) => {
    let out = '';
    const onData = (chunk) => {
      out += chunk.toString();
      if (out.includes('Local:')) resolve();
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error('vite preview exited: ' + out));
    });
    setTimeout(() => reject(new Error('vite preview did not start in time: ' + out)), 20000);
  });
  await ready;
  return proc;
}

export function stopPreviewServer(proc) {
  if (proc && !proc.killed) proc.kill();
}

export async function launchBrowser() {
  // Normally Playwright resolves its own managed browser (installed via `npx playwright
  // install chromium`). Some sandboxed CI environments instead pre-provision a browser at a
  // fixed path and block the network calls Playwright's own resolution would otherwise make —
  // set PLAYWRIGHT_CHROMIUM_PATH to point at it in that case.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  return chromium.launch({ executablePath });
}

// Opens every collapsible "Advanced" section and every sub-reveal toggle, so every numeric
// input in the app is mounted in the DOM. Update this list if App.jsx's section headers change.
export async function expandEverything(page) {
  await page.click('text=Advanced');
  await page.waitForTimeout(150);

  const collapsedByDefaultHeaders = [
    'SOCIAL SECURITY (OPTIONAL)', 'AFTER-TAX WITHDRAWALS', 'SPENDING GLIDE PATH',
    'EARLY RETIREMENT', 'MARKET VOLATILITY', 'WITHDRAWAL ORDER', 'CONTRIBUTION LIMIT CHECK',
    'ANNUAL BUDGET', 'TAX STRATEGY',
  ];
  for (const h of collapsedByDefaultHeaders) {
    const btn = page.locator(`button.rr-collapsible-header:has-text("${h}")`).first();
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(80);
    }
  }

  const subRevealToggles = [
    'tap to add a slowdown',
    'tap to cap it',
    'tap to test stopping early',
    'Not included — tap to add',
  ];
  for (const t of subRevealToggles) {
    const btn = page.locator(`button:has-text("${t}")`).first();
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(80);
    }
  }
  await page.waitForTimeout(200);
}

export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION_RESET') && !m.text().includes('favicon')) {
      errors.push(m.text());
    }
  });
  return errors;
}

export async function isShowingErrorBoundary(page) {
  const text = await page.locator('body').innerText().catch(() => 'READ_FAILED');
  return text.includes('Something went wrong') || text === 'READ_FAILED';
}
