// Regression suite mirroring apps/retirement-runway/tests/app.e2e.test.mjs — see CLAUDE.md
// for the checklist this satisfies. Two input types here: range sliders (native browser
// behavior clamps these to their declared min/max, so "extreme value" testing means the
// boundaries, exercised via Home/End keys like a real user) and a handful of free-text number
// inputs (insurance, HOA, renters insurance, standard deduction) which have no such ceiling
// and get the same extreme-value sweep as retirement-runway's inputs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_URL, startPreviewServer, stopPreviewServer, launchBrowser,
  expandEverything, collectErrors, isShowingErrorBoundary, fieldByLabel,
} from './helpers.mjs';

const TEST_TIMEOUT_MS = 60_000;

let previewProc;

before(async () => {
  previewProc = await startPreviewServer();
});

after(() => {
  stopPreviewServer(previewProc);
});

test('sweeps every slider to its min/max and every number field to extreme values', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await expandEverything(page);

  const sliders = page.locator('input[type="range"]');
  const sliderCount = await sliders.count();
  assert.ok(sliderCount >= 10, `expected most sliders mounted after expanding everything, got ${sliderCount}`);

  for (let i = 0; i < sliderCount; i++) {
    const slider = sliders.nth(i);
    await slider.focus();
    await slider.press('End'); // native browser behavior: jumps to max
    await page.waitForTimeout(60);
    assert.equal(await isShowingErrorBoundary(page), false, `slider #${i} crashed the app at its max`);
    await slider.press('Home'); // jumps to min
    await page.waitForTimeout(60);
    assert.equal(await isShowingErrorBoundary(page), false, `slider #${i} crashed the app at its min`);
  }

  const numberInputs = page.locator('input[type="number"]');
  const numberCount = await numberInputs.count();
  assert.ok(numberCount >= 3, `expected the free-text number fields mounted, got ${numberCount}`);

  const extremes = ['999999999', '-999999999', ''];
  for (let i = 0; i < numberCount; i++) {
    const input = numberInputs.nth(i);
    const original = await input.inputValue().catch(() => '');
    for (const value of extremes) {
      await input.click({ clickCount: 3, timeout: 5000 });
      await input.fill('', { timeout: 5000 });
      if (value !== '') await input.type(value, { delay: 5, timeout: 15000 });
      await page.waitForTimeout(100);
      assert.equal(await isShowingErrorBoundary(page), false, `number input #${i} crashed the app with value "${value}"`);
    }
    await input.click({ clickCount: 3 }).catch(() => {});
    await input.fill(original || '0').catch(() => {});
  }

  assert.deepEqual(errors, [], 'no console/page errors during the sweep');
  await context.close();
  await browser.close();
});

test('rapid multi-field editing across sliders and toggles does not crash', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.click('text=Advanced');

  const sliders = page.locator('input[type="range"]');
  const homePriceSlider = sliders.nth(0);
  const downPaymentSlider = sliders.nth(1);
  const rateSlider = sliders.nth(2);

  for (let i = 0; i < 15; i++) {
    const target = [homePriceSlider, downPaymentSlider, rateSlider][i % 3];
    await target.focus();
    await target.press(i % 2 === 0 ? 'End' : 'Home');
    await page.waitForTimeout(40);
  }
  // 100% down payment collapses the loan to zero — a real edge case, not just a stress test
  await downPaymentSlider.focus();
  await downPaymentSlider.press('End');
  await page.waitForTimeout(100);

  await page.click('button:has-text("tap to itemize")').catch(() => {});
  await page.waitForTimeout(100);

  assert.equal(await isShowingErrorBoundary(page), false, 'app crashed during rapid multi-field editing');
  assert.deepEqual(errors, [], 'no console/page errors during rapid multi-field editing');

  await context.close();
  await browser.close();
});

test('autosaves to localStorage and restores after a genuine browser restart', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const insuranceInput = fieldByLabel(page, 'Homeowners insurance');
  // this field is only mounted once "Advanced" + "Ownership Costs" are visible
  await page.click('text=Advanced');
  await page.waitForTimeout(150);
  await insuranceInput.click({ clickCount: 3 });
  await insuranceInput.fill('');
  await insuranceInput.type('2400', { delay: 15 });
  await page.waitForTimeout(700);

  const saved = await page.evaluate(() => localStorage.getItem('rent-vs-buy:autosave-v1'));
  assert.ok(saved, 'autosave key should exist in localStorage');
  assert.equal(JSON.parse(saved).homeInsuranceAnnual, '2400');

  const state = await context.storageState();
  await context.close();

  const context2 = await browser.newContext({ storageState: state });
  const page2 = await context2.newPage();
  await page2.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page2.click('text=Advanced');
  await page2.waitForTimeout(150);
  const restored = await fieldByLabel(page2, 'Homeowners insurance').inputValue();
  assert.equal(restored, '2400');
  await context2.close();
  await browser.close();
});

test('an explicit shared link overrides the local autosave', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.click('text=Advanced');
  await page.waitForTimeout(150);

  const insuranceInput = fieldByLabel(page, 'Homeowners insurance');
  await insuranceInput.click({ clickCount: 3 });
  await insuranceInput.fill('');
  await insuranceInput.type('3000', { delay: 15 });
  await page.waitForTimeout(700);

  await page.click('button:has-text("Copy shareable link")');
  await page.waitForTimeout(200);
  const shareUrl = await page.locator('input[readonly]').inputValue();

  await insuranceInput.click({ clickCount: 3 });
  await insuranceInput.fill('');
  await insuranceInput.type('999', { delay: 15 });
  await page.waitForTimeout(700);

  await page.goto(shareUrl, { waitUntil: 'networkidle' });
  await page.click('text=Advanced');
  await page.waitForTimeout(150);
  const fromLink = await fieldByLabel(page, 'Homeowners insurance').inputValue();
  assert.equal(fromLink, '3000', 'the link (3000) should win over the newer local save (999)');

  await context.close();
  await browser.close();
});

test('"Start fresh" resets the autosave back to defaults', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.click('text=Advanced');
  await page.waitForTimeout(150);

  const insuranceInput = fieldByLabel(page, 'Homeowners insurance');
  await insuranceInput.click({ clickCount: 3 });
  await insuranceInput.fill('');
  await insuranceInput.type('5000', { delay: 15 });
  await page.waitForTimeout(700);

  page.once('dialog', (d) => d.accept());
  await page.click('button:has-text("Start fresh")');
  await page.waitForTimeout(700);

  await page.reload({ waitUntil: 'networkidle' });
  await page.click('text=Advanced');
  await page.waitForTimeout(150);
  const value = await fieldByLabel(page, 'Homeowners insurance').inputValue();
  assert.equal(value, '1800', 'insurance should be back to its default after Start fresh + reload');

  await context.close();
  await browser.close();
});

test('corrupted localStorage falls back to defaults instead of crashing', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('rent-vs-buy:autosave-v1', '{not valid json!!'));
  await page.reload({ waitUntil: 'networkidle' });

  assert.equal(await isShowingErrorBoundary(page), false);
  assert.deepEqual(errors, []);

  await context.close();
  await browser.close();
});
