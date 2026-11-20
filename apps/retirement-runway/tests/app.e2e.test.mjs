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
// The numeric-input sweep scales with how many optional sections/inputs this calculator has grown
// to (it fills every input with 3 extreme values, one at a time) — a fixed 60s budget kept getting
// tighter as sections were added and finally tipped over into a timeout with no crash involved.
// Give it its own, larger budget instead of raising the ceiling for every other test too.
const SWEEP_TIMEOUT_MS = 150_000;

let previewProc;

before(async () => {
  previewProc = await startPreviewServer();
});

after(() => {
  stopPreviewServer(previewProc);
});

test('sweeps every numeric input with extreme values without crashing or hanging', { timeout: SWEEP_TIMEOUT_MS }, async (t) => {
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

test('Your Accounts what-if: excluding an account and overriding an amount, then resetting', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const card = page.locator('[data-account-card]').first();
  const monthly = card.locator('input[aria-label^="Monthly contribution"]');
  await monthly.fill('1000');
  const totalLine = page.locator('text=/^Total: /').first();
  await page.waitForTimeout(100);
  assert.match(await totalLine.innerText(), /Total: \$1,000\/mo/);

  // exclude the account: it drops out of the math, but its real amount is kept
  await card.locator('input[type="checkbox"]').uncheck();
  await page.waitForTimeout(100);
  assert.match(await totalLine.innerText(), /Total: \$0\/mo.*what-if scenario \(actual \$1,000\/mo/);
  assert.equal(await monthly.inputValue(), '1000');

  // include it again with a different what-if amount
  await card.locator('input[type="checkbox"]').check();
  await card.locator('button:has-text("try a different amount")').click();
  await card.locator('input[aria-label^="What-if monthly amount"]').fill('250');
  await page.waitForTimeout(700); // past the autosave debounce
  assert.match(await totalLine.innerText(), /Total: \$250\/mo/);
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('retirement-runway:autosave-v1')));
  assert.equal(saved.accounts[0].whatIfMonthly, 250);
  assert.equal(saved.accounts[0].monthly, 1000);

  // reset restores the actual amounts
  await page.click('button:has-text("reset what-if scenario")');
  await page.waitForTimeout(100);
  assert.match(await totalLine.innerText(), /Total: \$1,000\/mo/);
  assert.doesNotMatch(await totalLine.innerText(), /what-if/);

  assert.equal(await isShowingErrorBoundary(page), false);
  assert.deepEqual(errors, []);
  await context.close();
  await browser.close();
});

test('per-account balances add up to the starting balance and drop out when the account is excluded', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const startLine = page.locator('[data-starting-balance]');
  await page.locator('input[aria-label="Other savings not listed in Your Accounts"]').fill('5000');
  await page.click('text=+ add account');
  const cards = page.locator('[data-account-card]');
  await cards.nth(0).locator('input[aria-label^="Current balance"]').fill('100000');
  await cards.nth(1).locator('input[aria-label^="Current balance"]').fill('40000');
  await page.waitForTimeout(100);
  assert.match(await startLine.innerText(), /Starting balance: \$145,000/);

  // excluding the second account removes its balance from the plan, but keeps the number on the card
  await cards.nth(1).locator('input[type="checkbox"]').uncheck();
  await page.waitForTimeout(700);
  assert.match(await startLine.innerText(), /Starting balance: \$105,000/);
  assert.equal(await cards.nth(1).locator('input[aria-label^="Current balance"]').inputValue(), '40000');
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('retirement-runway:autosave-v1')));
  assert.equal(saved.accounts[1].balance, 40000);
  assert.equal(saved.accounts[1].included, false);

  assert.equal(await isShowingErrorBoundary(page), false);
  assert.deepEqual(errors, []);
  await context.close();
  await browser.close();
});

test('a profile saved before per-account balances keeps its total as "other savings"', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('retirement-runway:autosave-v1', JSON.stringify({
      currentBalance: 250000,
      accounts: [{ id: 'old1', label: 'Old 401k', monthly: 500, treatment: 'Roth (after-tax)', type: '401k' }],
    }));
  });
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  assert.match(await page.locator('[data-starting-balance]').innerText(), /Starting balance: \$250,000/);
  assert.equal(await page.locator('input[aria-label^="Current balance for Old 401k"]').inputValue(), '0');

  assert.equal(await isShowingErrorBoundary(page), false);
  assert.deepEqual(errors, []);
  await context.close();
  await browser.close();
});

test('contribution gaps: custom start/length/amount, several per account, gap cost, and reset', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const card = page.locator('[data-account-card]').first();
  await card.locator('input[aria-label^="Current balance"]').fill('50000');
  await card.locator('input[aria-label^="Monthly contribution"]').fill('1000');
  const impact = page.locator('[data-gap-impact]');
  const costOf = async () => {
    await page.waitForTimeout(100);
    const m = (await impact.innerText()).match(/Gap cost: \$([\d,]+)/);
    return Number(m[1].replace(/,/g, ''));
  };

  // default gap: full pause, starting now, for 1 year — skips $12,000 and costs more than that
  await card.locator('button:has-text("pause contributions (gap)")').click();
  await page.waitForTimeout(100);
  assert.match(await impact.innerText(), /put in \$12,000 less/);
  const oneYear = await costOf();
  assert.ok(oneYear > 12000, `growth should make a 1-year gap cost more than $12,000, got ${oneYear}`);
  assert.match(await page.locator('[data-starting-balance]').innerText(), /Starting balance: \$50,000/);

  // fully custom length: 7 months
  await card.locator('input[aria-label^="Gap length for"]').fill('7');
  await card.locator('select[aria-label^="Gap length unit"]').selectOption('months');
  assert.match(await impact.innerText(), /put in \$7,000 less/);

  // a partial cut instead of a full pause: $400/mo during 7 months → $4,200 less
  await card.locator('input[aria-label^="Contribution during gap"]').fill('400');
  await page.waitForTimeout(100);
  assert.match(await impact.innerText(), /put in \$4,200 less/);

  // a gap that starts after retirement changes nothing, and the impact box goes away
  await card.locator('select[aria-label^="Gap start unit"]').selectOption('age');
  await card.locator('input[aria-label^="Gap start for"]').fill('70');
  await page.waitForTimeout(100);
  assert.equal(await impact.count(), 0);

  // a second gap on the same account: a quick-pick "1 yr" full pause starting 2.5 years from now
  await card.locator('input[aria-label^="Gap start for"]').first().fill('40');
  await card.locator('button:has-text("+ add another gap")').click();
  const second = card.locator('[data-gap-box]').nth(1);
  await second.locator('input[aria-label^="Gap start for"]').fill('2.5');
  await second.locator('select[aria-label^="Gap start unit"]').selectOption('yearsFromNow');
  await second.locator('button:has-text("1 yr")').click();
  await page.waitForTimeout(100);
  // first gap (7 mo at $400, from age 40) = $4,200 less; second (12 mo at $0) = $12,000 less
  assert.match(await impact.innerText(), /put in \$16,200 less/);

  // "until retirement" is the most expensive pause
  await second.locator('button:has-text("until retirement")').click();
  const untilRetirement = await costOf();
  assert.ok(untilRetirement > oneYear);

  // a catch-up period (more than usual) shows as a gain, not a cost
  await card.locator('[data-gap-box]').nth(1).locator('.rr-x-btn').click();
  await card.locator('input[aria-label^="Contribution during gap"]').fill('3000');
  await page.waitForTimeout(700);
  assert.match(await impact.innerText(), /Extra contributions add/);
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('retirement-runway:autosave-v1')));
  assert.equal(saved.accounts[0].gaps.length, 1);
  assert.equal(saved.accounts[0].gaps[0].monthlyDuring, '3000');

  await page.click('button:has-text("reset what-if scenario")');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-gap-box]').count(), 0);
  assert.equal(await impact.count(), 0);

  assert.equal(await isShowingErrorBoundary(page), false);
  assert.deepEqual(errors, []);
  await context.close();
  await browser.close();
});

// Dollar values below were cross-checked against an independent textbook calculation (10% nominal,
// 3% inflation, age 30 -> 65). They pin two fixes: the monthly rate is the exact 12th root of the
// annual real return (not annual / 12, which overstated growth), and a full pause also stops the
// account's share of "% of raise -> retirement" money.
test('gap math: exact monthly compounding, and a full pause also stops raise-allocated money', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const card = page.locator('[data-account-card]').first();
  await card.locator('input[aria-label^="Current balance"]').fill('50000');
  await card.locator('input[aria-label^="Monthly contribution"]').fill('1000');
  await card.locator('button:has-text("pause contributions (gap)")').click();
  await page.waitForTimeout(150);
  const impact = page.locator('[data-gap-impact]');
  // 1-year full pause, no raise money: $2,135,072 -> $2,019,398
  assert.match(await impact.innerText(), /from \$2,135,072 to \$2,019,398/);

  // with 50% of raises going to retirement, pausing until retirement leaves only the $50k growing
  await page.locator('span.rr-field-label:has-text("% of raise") + input').fill('50');
  await card.locator('select[aria-label^="Gap length unit"]').selectOption('retirement');
  await page.waitForTimeout(150);
  assert.match(await impact.innerText(), /from \$4,327,702 to \$499,357/);

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

// Usage tracking is compiled in only when the deploy workflow supplies VITE_GOATCOUNTER_URL.
// A default build — local dev, this suite, anyone who clones the repo — must stay completely
// inert: no third-party script, no request off-box. This also guards against the endpoint
// ever being hardcoded back into the source.
test('ships no analytics script when VITE_GOATCOUNTER_URL is unset at build time', { timeout: TEST_TIMEOUT_MS }, async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  const analyticsRequests = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.includes('goatcounter') || url.includes('gc.zgo.at')) analyticsRequests.push(url);
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  assert.deepEqual(analyticsRequests, [], 'an unconfigured build must not contact an analytics endpoint');
  assert.equal(await page.locator('script[data-goatcounter]').count(), 0);
  assert.equal(await isShowingErrorBoundary(page), false);
  assert.deepEqual(errors, []);

  await context.close();
  await browser.close();
});
