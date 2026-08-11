// Regression suite for the two failure modes this app has actually hit in production:
//
// 1. Crash/freeze from unbounded numeric inputs — retirement-age/horizon-age/return-rate
//    fields directly sized simulation loops with no ceiling. An extreme or transient value
//    (e.g. retireAge > horizonAge while both are mid-edit) sent Array() a negative or
//    huge length, or ran a multi-billion-iteration loop, freezing the tab or throwing inside
//    recharts and unmounting the whole app.
// 2. Lost input — the only persistence was an explicit "copy shareable link" click; a refresh
//    (or the crash above) lost everything otherwise.
//
// Run with `npm run test:e2e` (builds first via the pretest hook, then runs this against
// `vite preview`). Every calculator in this repo should have an equivalent suite — see
// CLAUDE.md at the repo root for the checklist this file satisfies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_URL, startPreviewServer, stopPreviewServer, launchBrowser,
  expandEverything, collectErrors, isShowingErrorBoundary,
} from './helpers.mjs';

// Each test launches and closes its OWN browser rather than sharing one across the file — a
// shared browser instance was found to occasionally leave later tests hanging indefinitely
// (browser.newContext() has no built-in timeout against a wedged browser process). A fresh
// launch per test costs a little time but has proven far more reliable in practice, and the
// per-test `timeout` option below is a hard backstop either way.
const TEST_TIMEOUT_MS = 60_000;

let previewProc;

before(async () => {
  previewProc = await startPreviewServer();
});

after(() => {
  stopPreviewServer(previewProc);
});

test('sweeps every numeric input with extreme values without crashing or hanging', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await expandEverything(page);

  const numberInputs = page.locator('input[type="number"]');
  const count = await numberInputs.count();
  assert.ok(count >= 30, `expected most numeric inputs to be mounted after expanding everything, got ${count}`);

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

test('reproduces the original crash scenario: retireAge/horizonAge edited back and forth', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.click('text=Advanced');

  const numberInputs = page.locator('input[type="number"]');
  const currentAgeInput = numberInputs.nth(0);
  const horizonInput = numberInputs.nth(1);
  const retireAgeInput = numberInputs.nth(2);

  async function retype(locator, value) {
    await locator.click({ clickCount: 3 });
    await locator.fill('');
    await locator.type(String(value), { delay: 30 });
  }

  await retype(retireAgeInput, 70);
  await page.waitForTimeout(500);
  await retype(horizonInput, 95);
  await page.waitForTimeout(500);
  await retype(retireAgeInput, 120); // transiently > horizonAge
  await page.waitForTimeout(500);
  await retype(currentAgeInput, 40);
  await page.waitForTimeout(500);
  await retireAgeInput.click({ clickCount: 3 });
  await retireAgeInput.fill('');
  await retireAgeInput.type('999999999', { delay: 40 }); // extreme, digit by digit
  await page.waitForTimeout(500);
  await retype(retireAgeInput, 68);
  await page.waitForTimeout(500);
  await retype(horizonInput, 90);
  await page.waitForTimeout(500);

  assert.equal(await isShowingErrorBoundary(page), false, 'app crashed during multi-field editing');
  assert.deepEqual(errors, [], 'no console/page errors during multi-field editing');

  await context.close();
  await browser.close();
});

test('removing all accounts/expenses does not crash the app', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.click('text=Advanced');
  while ((await page.locator('.rr-x-btn').count()) > 0) {
    await page.locator('.rr-x-btn').first().click();
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(200);

  assert.equal(await isShowingErrorBoundary(page), false);
  assert.deepEqual(errors, []);
  await context.close();
  await browser.close();
});

test('autosaves to localStorage and restores after a genuine browser restart', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const salaryInput = page.locator('input[type="number"]').nth(3);
  await salaryInput.click({ clickCount: 3 });
  await salaryInput.fill('');
  await salaryInput.type('88000', { delay: 15 });
  await page.waitForTimeout(700); // past the debounce

  const saved = await page.evaluate(() => localStorage.getItem('retirement-runway:autosave-v1'));
  assert.ok(saved, 'autosave key should exist in localStorage');
  // form fields store raw strings (App.jsx never coerces on input), so this is '88000', not 88000
  assert.equal(JSON.parse(saved).salary, '88000');

  // simulate closing and reopening the browser: persist storage state to a fresh context
  const state = await context.storageState();
  await context.close();

  const context2 = await browser.newContext({ storageState: state });
  const page2 = await context2.newPage();
  await page2.goto(BASE_URL, { waitUntil: 'networkidle' });
  const restored = await page2.locator('input[type="number"]').nth(3).inputValue();
  assert.equal(restored, '88000');
  await context2.close();
  await browser.close();
});

test('an explicit shared link overrides the local autosave', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const salaryInput = page.locator('input[type="number"]').nth(3);
  await salaryInput.click({ clickCount: 3 });
  await salaryInput.fill('');
  await salaryInput.type('142000', { delay: 15 });
  await page.waitForTimeout(700);

  await page.click('button:has-text("Copy shareable link")');
  await page.waitForTimeout(200);
  const shareUrl = await page.locator('input[readonly]').inputValue();

  await salaryInput.click({ clickCount: 3 });
  await salaryInput.fill('');
  await salaryInput.type('55000', { delay: 15 });
  await page.waitForTimeout(700); // this overwrites the local save to 55000

  await page.goto(shareUrl, { waitUntil: 'networkidle' });
  const fromLink = await page.locator('input[type="number"]').nth(3).inputValue();
  assert.equal(fromLink, '142000', 'the link (142000) should win over the newer local save (55000)');

  await context.close();
  await browser.close();
});

test('"Start fresh" resets the autosave back to defaults', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const salaryInput = page.locator('input[type="number"]').nth(3);
  await salaryInput.click({ clickCount: 3 });
  await salaryInput.fill('');
  await salaryInput.type('200000', { delay: 15 });
  await page.waitForTimeout(700);

  page.once('dialog', (d) => d.accept());
  await page.click('button:has-text("Start fresh")');
  await page.waitForTimeout(700);

  await page.reload({ waitUntil: 'networkidle' });
  const value = await page.locator('input[type="number"]').nth(3).inputValue();
  assert.equal(value, '75000', 'salary should be back to its default after Start fresh + reload');

  await context.close();
  await browser.close();
});

test('corrupted localStorage falls back to defaults instead of crashing', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('retirement-runway:autosave-v1', '{not valid json!!'));
  await page.reload({ waitUntil: 'networkidle' });

  assert.equal(await isShowingErrorBoundary(page), false);
  assert.deepEqual(errors, []);
  const salary = await page.locator('input[type="number"]').nth(3).inputValue();
  assert.equal(salary, '75000');

  await context.close();
  await browser.close();
});
