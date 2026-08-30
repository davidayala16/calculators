// Regression suite for the failure modes covered by CLAUDE.md's crash-proofing checklist:
//
// 1. Crash/freeze from unbounded numeric inputs — years/months-bounded loops (amortization,
//    the rate sensitivity grid, the equity chart) are all sized directly from raw user-typed
//    numbers. An extreme, malformed, or transient value must never throw (e.g. a negative
//    array length) or freeze the tab (an unbounded loop).
// 2. Lost input — the only persistence beyond an explicit "Copy shareable link" click is a
//    debounced localStorage autosave; a refresh (or the crash above) must not lose it.
//
// Run with `npm run test:e2e` (builds first via the pretest hook, then runs this against
// `vite preview`). See CLAUDE.md at the repo root for the checklist this file satisfies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_URL, startPreviewServer, stopPreviewServer, launchBrowser,
  expandEverything, collectErrors, isShowingErrorBoundary,
} from './helpers.mjs';

// Each test launches and closes its OWN browser rather than sharing one across the file — a
// shared browser instance was found (in the sibling retirement-runway app) to occasionally
// leave later tests hanging indefinitely when the browser hiccuped during an earlier, heavier
// test. The per-test launch/close plus an explicit `timeout` option is a proven-more-reliable
// pattern here, not a stylistic preference.
const TEST_TIMEOUT_MS = 60_000;
// The sweep runs twice (once per buy-before-sell / sell-then-buy timing mode, to mount each
// mode's conditional fields) over every numeric input with three extreme values each — give it
// a much larger budget than the other tests.
const SWEEP_TIMEOUT_MS = 180_000;

let previewProc;

before(async () => {
  previewProc = await startPreviewServer();
});

after(() => {
  stopPreviewServer(previewProc);
});

async function retype(locator, value) {
  await locator.click({ clickCount: 3 });
  await locator.fill('');
  if (value !== '') await locator.type(String(value), { delay: 5 });
}

async function sweepAllNumberInputs(page, errors, label) {
  const numberInputs = page.locator('input[type="number"]');
  const count = await numberInputs.count();
  const extremes = ['999999999', '-999999999', ''];
  for (let i = 0; i < count; i++) {
    const input = numberInputs.nth(i);
    const original = await input.inputValue().catch(() => '');
    for (const value of extremes) {
      await input.click({ clickCount: 3, timeout: 5000 });
      await input.fill('', { timeout: 5000 });
      if (value !== '') await input.type(value, { delay: 5, timeout: 15000 });
      await page.waitForTimeout(60);
      const crashed = await isShowingErrorBoundary(page);
      assert.equal(crashed, false, `[${label}] input #${i} crashed the app with value "${value}"`);
    }
    await input.click({ clickCount: 3 }).catch(() => {});
    await input.fill(original || '1').catch(() => {});
  }
  assert.deepEqual(errors, [], `[${label}] no console/page errors during the sweep`);
}

test('sweeps every numeric input with extreme values, across both timing modes, without crashing or hanging', { timeout: SWEEP_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await expandEverything(page);
  await page.click('button:has-text("ARM")');
  await page.waitForTimeout(100);

  await page.click('button:has-text("Buy before selling")');
  await page.waitForTimeout(150);
  let count = await page.locator('input[type="number"]').count();
  assert.ok(count >= 25, `expected most numeric inputs to be mounted after expanding everything, got ${count}`);
  await sweepAllNumberInputs(page, errors, 'buy-before-sell');

  await page.click('button:has-text("Sell, then buy")');
  await page.waitForTimeout(150);
  count = await page.locator('input[type="number"]').count();
  assert.ok(count >= 20, `expected numeric inputs to remain mounted in sell-then-buy mode, got ${count}`);
  await sweepAllNumberInputs(page, errors, 'sell-then-buy');

  await context.close();
  await browser.close();
});

test('reproduces transient bad states: underwater equity mid-edit and rapid timing-mode switches', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await expandEverything(page);

  const numberInputs = page.locator('input[type="number"]');
  // "Estimated sale price" and "Remaining mortgage balance" are the first two inputs mounted
  // by default — pushing the balance above the sale price mid-edit is a normal transient state
  // (negative equity) that the selling-proceeds math must floor at 0, not crash on.
  const saleValueInput = numberInputs.nth(0);
  const balanceInput = numberInputs.nth(1);

  await retype(balanceInput, 900000); // transiently owes more than the home is worth
  await page.waitForTimeout(300);
  await retype(saleValueInput, 100000); // and the "sale price" drops well below that
  await page.waitForTimeout(300);
  await retype(balanceInput, 300000);
  await page.waitForTimeout(300);
  await retype(saleValueInput, 500000);
  await page.waitForTimeout(300);

  // Down payment transiently exceeding the purchase price (both mid-edit). Field order after
  // expandEverything(): 7 old-home + 5 selling-cost inputs come before THE NEW HOME's own
  // fields, so "Down payment" (the 2nd field in that section) lands at index 13.
  const downPaymentInput = page.locator('input[type="number"]').nth(13); // "Down payment" under THE NEW HOME
  await retype(downPaymentInput, 999999999);
  await page.waitForTimeout(300);
  await retype(downPaymentInput, 120000);
  await page.waitForTimeout(300);

  // Rapidly cycle every timing mode with extreme bridge/gap values set, mirroring the
  // retireAge/horizonAge edit-order crash this pattern is modeled on.
  await page.click('button:has-text("Buy before selling")');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Sell, then buy")');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Simultaneous close")');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Buy before selling")');
  await page.waitForTimeout(200);

  assert.equal(await isShowingErrorBoundary(page), false, 'app crashed during multi-field editing');
  assert.deepEqual(errors, [], 'no console/page errors during multi-field editing');

  await context.close();
  await browser.close();
});

test('autosaves to localStorage and restores after a genuine browser restart', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const saleValueInput = page.locator('input[type="number"]').nth(0);
  await retype(saleValueInput, 725000);
  await page.waitForTimeout(700); // past the debounce

  const saved = await page.evaluate(() => localStorage.getItem('home-sale-purchase:autosave-v1'));
  assert.ok(saved, 'autosave key should exist in localStorage');
  assert.equal(JSON.parse(saved).oldHomeValue, '725000');

  // simulate closing and reopening the browser: persist storage state to a fresh context
  const state = await context.storageState();
  await context.close();

  const context2 = await browser.newContext({ storageState: state });
  const page2 = await context2.newPage();
  await page2.goto(BASE_URL, { waitUntil: 'networkidle' });
  const restored = await page2.locator('input[type="number"]').nth(0).inputValue();
  assert.equal(restored, '725000');
  await context2.close();
  await browser.close();
});

test('an explicit shared link overrides the local autosave', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const saleValueInput = page.locator('input[type="number"]').nth(0);
  await retype(saleValueInput, 812000);
  await page.waitForTimeout(700);

  await page.click('button:has-text("Copy shareable link")');
  await page.waitForTimeout(200);
  const shareUrl = await page.locator('input[readonly]').inputValue();

  await retype(saleValueInput, 333000);
  await page.waitForTimeout(700); // this overwrites the local save to 333000

  await page.goto(shareUrl, { waitUntil: 'networkidle' });
  const fromLink = await page.locator('input[type="number"]').nth(0).inputValue();
  assert.equal(fromLink, '812000', 'the link (812000) should win over the newer local save (333000)');

  await context.close();
  await browser.close();
});

test('"Start fresh" resets the autosave back to defaults', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const saleValueInput = page.locator('input[type="number"]').nth(0);
  await retype(saleValueInput, 999000);
  await page.waitForTimeout(700);

  page.once('dialog', (d) => d.accept());
  await page.click('button:has-text("Start fresh")');
  await page.waitForTimeout(700);

  await page.reload({ waitUntil: 'networkidle' });
  const value = await page.locator('input[type="number"]').nth(0).inputValue();
  assert.equal(value, '500000', 'sale price should be back to its default after Start fresh + reload');

  const saved = await page.evaluate(() => localStorage.getItem('home-sale-purchase:autosave-v1'));
  assert.equal(saved, null, 'autosave key should be cleared, not just overwritten with defaults');

  await context.close();
  await browser.close();
});

test('corrupted localStorage falls back to defaults instead of crashing', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('home-sale-purchase:autosave-v1', '{not valid json!!'));
  await page.reload({ waitUntil: 'networkidle' });

  assert.equal(await isShowingErrorBoundary(page), false);
  assert.deepEqual(errors, []);
  const saleValue = await page.locator('input[type="number"]').nth(0).inputValue();
  assert.equal(saleValue, '500000');

  await context.close();
  await browser.close();
});
