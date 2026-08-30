// Shared plumbing for the e2e suite: spins up `vite preview` against the already-built
// dist/ (run `vite build` first — the `pretest:e2e` npm script does this for you) and
// hands back a Playwright browser pointed at it.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4331;
export const BASE_URL = `http://localhost:${PORT}/calculators/home-sale-purchase/`;

export async function startPreviewServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
    // `npx` spawns the real vite server as a grandchild (via an intermediate shell) — killing just
    // the npx pid can leave that grandchild orphaned and running, which keeps its stdio pipes open
    // and the whole `node --test` process alive indefinitely even after every test has passed.
    // `detached: true` gives the tree its own process group, so stopPreviewServer can kill all of it.
    detached: true,
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
  if (!proc || proc.killed) return;
  try {
    process.kill(-proc.pid, 'SIGTERM'); // negative pid = whole process group, reaches the grandchild
  } catch (e) {
    proc.kill(); // group already gone — fall back to signaling just the direct child
  }
}

export async function launchBrowser() {
  // Normally Playwright resolves its own managed browser (installed via `npx playwright
  // install chromium`). Some sandboxed CI environments instead pre-provision a browser at a
  // fixed path and block the network calls Playwright's own resolution would otherwise make —
  // set PLAYWRIGHT_CHROMIUM_PATH to point at it in that case.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  return chromium.launch({ executablePath });
}

const ALWAYS_OPEN_HEADERS = [
  'TIMING SCENARIO', 'APPRECIATION', 'RATE SENSITIVITY GRID SETTINGS',
  'FULL RATE SENSITIVITY TABLE', 'HOME EQUITY', 'AMORTIZATION SCHEDULE', 'HOW THIS IS CALCULATED',
];

// Opens every collapsible section (the top four — YOUR CURRENT HOME, SELLING COSTS & TAXES,
// THE NEW HOME, LOAN OPTIONS — are expanded by default; everything below them starts
// collapsed) so every numeric input in the app is mounted in the DOM. Update this list if
// App.jsx's section headers change.
export async function expandEverything(page) {
  for (const h of ALWAYS_OPEN_HEADERS) {
    const btn = page.locator(`button.hsp-collapsible-header:has-text("${h}")`).first();
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(80);
    }
  }
  await page.waitForTimeout(150);
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
