// Regression suite mirroring the failure modes catalogued in the repo root CLAUDE.md:
//
// 1. Crash/freeze from unbounded numeric inputs — duration, dose interval, and recipe-yield
//    fields all feed division or array-sizing math with no inherent ceiling. An extreme or
//    transient value (e.g. dose interval near zero while duration is large) needs to stay
//    finite and bounded rather than throwing or freezing the tab.
// 2. Lost input — the only persistence beyond an explicit "copy shareable link" click is a
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
// shared browser instance was found (in the sibling retirement-runway suite) to occasionally
// leave later tests hanging indefinitely. A fresh launch per test costs a little time but has
// proven far more reliable, and the per-test `timeout` option below is a hard backstop either way.
const TEST_TIMEOUT_MS = 60_000;

let previewProc;

before(async () => {
  previewProc = await startPreviewServer();
});

after(() => {
  stopPreviewServer(previewProc);
});

test('sweeps every numeric input with extreme values without crashing or hanging', { timeout: TEST_TIMEOUT_MS }, async (_t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await expandEverything(page);

  const numberInputs = page.locator('input[type="number"]');
  const count = await numberInputs.count();
  assert.ok(count >= 15, `expected most numeric inputs to be mounted after expanding everything, got ${count}`);

  const extremes = ['999999999', '-999999999', ''];
  for (let i = 0; i < count; i++) {
    const input = numberInputs.nth(i);
    const original = await input.inputValue().catch(() => '');
    for (const value of extremes) {
      await input.click({ clickCount: 3, timeout: 5000 });
      await input.fill('', { timeout: 5000 });
      if (value !== '') await input.type(value, { delay: 5, timeout: 15000 });
      await page.waitForTimeout(100);
      const crashed = await isShowingErrorBoundary(page);
      assert.equal(crashed, false, `input #${i} crashed the app with value "${value}"`);
    }
    await input.click({ clickCount: 3 }).catch(() => {});
    await input.fill(original || '1').catch(() => {});
  }

  assert.deepEqual(errors, [], 'no console/page errors during the sweep');
  await context.close();
  await browser.close();
});

test('reproduces a transient bad-state scenario: near-zero dose interval with a huge duration', { timeout: TEST_TIMEOUT_MS }, async (_t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.click('text=Advanced');
  await page.click('button.cg-collapsible-header:has-text("DOSING & PACKAGING")');
  await page.waitForTimeout(100);
  await page.click('button.cg-collapsible-header:has-text("RECIPE BASE")');
  await page.waitForTimeout(100);

  const numberInputs = page.locator('input[type="number"]');
  const durationHrsInput = numberInputs.nth(1);
  const durationMinsInput = numberInputs.nth(2);

  async function retype(locator, value) {
    await locator.click({ clickCount: 3 });
    await locator.fill('');
    await locator.type(String(value), { delay: 20 });
  }

  const doseIntervalInput = page.locator('label:has-text("Minutes between doses") + input');
  const baseCarbsInput = page.locator('label:has-text("This batch yields (g carbs)") + input');

  await retype(durationHrsInput, 999999999); // extreme, digit by digit
  await page.waitForTimeout(300);
  await retype(doseIntervalInput, 0); // interval collapses toward zero while duration is huge
  await page.waitForTimeout(300);
  await retype(baseCarbsInput, 0); // base recipe yield collapses toward zero mid-edit
  await page.waitForTimeout(300);
  await retype(durationMinsInput, -999999999); // negative, transiently makes total duration negative
  await page.waitForTimeout(300);
  await retype(durationHrsInput, 1);
  await page.waitForTimeout(300);
  await retype(durationMinsInput, 45);
  await page.waitForTimeout(300);
  await retype(doseIntervalInput, 20);
  await page.waitForTimeout(300);
  await retype(baseCarbsInput, 80);
  await page.waitForTimeout(300);

  assert.equal(await isShowingErrorBoundary(page), false, 'app crashed during multi-field editing');
  assert.deepEqual(errors, [], 'no console/page errors during multi-field editing');

  await context.close();
  await browser.close();
});

test('autosaves to localStorage and restores after a genuine browser restart', { timeout: TEST_TIMEOUT_MS }, async (_t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const distanceInput = page.locator('input[type="number"]').nth(0);
  await distanceInput.click({ clickCount: 3 });
  await distanceInput.fill('');
  await distanceInput.type('26.2', { delay: 15 });
  await page.waitForTimeout(700); // past the debounce

  const saved = await page.evaluate(() => localStorage.getItem('carb-gel-calculator:autosave-v1'));
  assert.ok(saved, 'autosave key should exist in localStorage');
  assert.equal(JSON.parse(saved).distance, '26.2');

  // simulate closing and reopening the browser: persist storage state to a fresh context
  const state = await context.storageState();
  await context.close();

  const context2 = await browser.newContext({ storageState: state });
  const page2 = await context2.newPage();
  await page2.goto(BASE_URL, { waitUntil: 'networkidle' });
  const restored = await page2.locator('input[type="number"]').nth(0).inputValue();
  assert.equal(restored, '26.2');
  await context2.close();
  await browser.close();
});

test('an explicit shared link overrides the local autosave', { timeout: TEST_TIMEOUT_MS }, async (_t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const distanceInput = page.locator('input[type="number"]').nth(0);
  await distanceInput.click({ clickCount: 3 });
  await distanceInput.fill('');
  await distanceInput.type('10', { delay: 15 });
  await page.waitForTimeout(700);

  await page.click('button:has-text("Copy shareable link")');
  await page.waitForTimeout(200);
  const shareUrl = await page.locator('input[readonly]').inputValue();

  await distanceInput.click({ clickCount: 3 });
  await distanceInput.fill('');
  await distanceInput.type('5', { delay: 15 });
  await page.waitForTimeout(700); // this overwrites the local save to 5

  await page.goto(shareUrl, { waitUntil: 'networkidle' });
  const fromLink = await page.locator('input[type="number"]').nth(0).inputValue();
  assert.equal(fromLink, '10', 'the link (10) should win over the newer local save (5)');

  await context.close();
  await browser.close();
});

test('"Start fresh" resets the autosave back to defaults', { timeout: TEST_TIMEOUT_MS }, async (_t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const distanceInput = page.locator('input[type="number"]').nth(0);
  await distanceInput.click({ clickCount: 3 });
  await distanceInput.fill('');
  await distanceInput.type('99', { delay: 15 });
  await page.waitForTimeout(700);

  page.once('dialog', (d) => d.accept());
  await page.click('button:has-text("Start fresh")');
  await page.waitForTimeout(700);

  await page.reload({ waitUntil: 'networkidle' });
  const value = await page.locator('input[type="number"]').nth(0).inputValue();
  assert.equal(value, '13.1', 'distance should be back to its default after Start fresh + reload');

  await context.close();
  await browser.close();
});

test('corrupted localStorage falls back to defaults instead of crashing', { timeout: TEST_TIMEOUT_MS }, async (_t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('carb-gel-calculator:autosave-v1', '{not valid json!!'));
  await page.reload({ waitUntil: 'networkidle' });

  assert.equal(await isShowingErrorBoundary(page), false);
  assert.deepEqual(errors, []);
  const distance = await page.locator('input[type="number"]').nth(0).inputValue();
  assert.equal(distance, '13.1');

  await context.close();
  await browser.close();
});
