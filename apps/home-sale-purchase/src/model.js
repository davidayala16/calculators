// Sell-your-current-home + buy-a-new-home calculator: models the selling side (commission,
// closing costs, capital gains tax, mortgage payoff) and the buying side (down payment sourced
// from sale proceeds + savings + optional bridge loan, closing costs, PMI, points, ARM/fixed
// loans) together, then compares the resulting new monthly payment against what you're paying
// today. Every function here is pure and independently testable — App.jsx only wires state to
// these and renders the result.
//
// Per CLAUDE.md's crash-proofing checklist: every loop bounded by a user-typed years/months
// value is clamped to a sane ceiling and floored at 0 (a normal mid-edit state, not an edge
// case), and every monetary value is clamped to a finite bound so an extreme input can't
// overflow to Infinity and crash the chart.
export const MAX_YEARS = 100;
export const MAX_DOLLARS = 1e12;
export const MAX_SENSITIVITY_ROWS = 60;
export const MAX_OVERLAP_MONTHS = 60; // no one realistically carries a bridge loan for 5+ years

const LONG_TERM_CAP_GAINS_EXCLUSION = { single: 250000, joint: 500000 };
const POINT_RATE_REDUCTION = 0.25; // percentage points of rate reduced per discount point — common industry rule of thumb

export function clampYears(y) {
  const n = Math.trunc(Number(y));
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), MAX_YEARS);
}

export function clampMonths(m, ceiling = MAX_YEARS * 12) {
  const n = Math.trunc(Number(m));
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), ceiling);
}

export function clampDollars(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(Math.max(v, -MAX_DOLLARS), MAX_DOLLARS);
}

function pctOf(v) {
  return Math.max(Number(v) || 0, 0);
}

// Standard fixed-payment mortgage formula, clamped so an extreme rate/balance can't overflow
// past Number.MAX_VALUE (which would otherwise flow straight into a chart and crash it).
export function computeMonthlyPayment(balance, annualRatePct, remainingMonths) {
  const months = Math.max(Math.trunc(Number(remainingMonths)) || 0, 0);
  const bal = Math.max(Number(balance) || 0, 0);
  if (months <= 0 || bal <= 0) return 0;
  const r = Number(annualRatePct) / 100 / 12;
  if (!Number.isFinite(r)) return 0;
  if (Math.abs(r) < 1e-9) return clampDollars(bal / months);
  const factor = Math.pow(1 + r, months);
  if (!Number.isFinite(factor) || factor <= 1) return clampDollars(bal * r); // extreme-rate fallback
  return clampDollars((bal * (r * factor)) / (factor - 1));
}

// Backwards-compatible alias matching the naming used elsewhere in this repo (rent-vs-buy).
export const monthlyMortgagePayment = (loanAmount, annualRatePct, termYears) =>
  computeMonthlyPayment(loanAmount, annualRatePct, clampYears(termYears) * 12);

// Year-by-year amortization schedule. Supports an optional ARM: after `arm.initialPeriodYears`
// the rate switches to `arm.postRatePct` and the payment recasts against the remaining balance
// and remaining term, matching how a real adjustable-rate mortgage actually re-amortizes.
export function buildAmortization({ loanAmount, ratePct, termYears, projectionYears, arm = null }) {
  const term = clampYears(termYears);
  const totalMonths = term * 12;
  const projMonths = Math.min(clampYears(projectionYears) * 12, totalMonths || MAX_YEARS * 12);
  let balance = Math.max(Number(loanAmount) || 0, 0);
  let rate = Number(ratePct) || 0;
  let payment = computeMonthlyPayment(balance, rate, totalMonths);
  const initialPayment = payment;
  const armSwitchMonth = arm ? clampYears(arm.initialPeriodYears) * 12 : null;

  const rows = [{ year: 0, principalPaid: 0, interestPaid: 0, balance: clampDollars(balance) }];
  let yearPrincipal = 0;
  let yearInterest = 0;
  let payoffMonth = null;

  for (let m = 1; m <= projMonths; m++) {
    if (armSwitchMonth !== null && m === armSwitchMonth + 1 && balance > 0) {
      rate = Number(arm.postRatePct) || rate;
      payment = computeMonthlyPayment(balance, rate, Math.max(totalMonths - armSwitchMonth, 0));
    }
    const interestPortion = balance > 0 ? balance * (rate / 100 / 12) : 0;
    const principalPortion = balance > 0 ? Math.min(Math.max(payment - interestPortion, 0), balance) : 0;
    balance = clampDollars(Math.max(balance - principalPortion, 0));
    if (payoffMonth === null && principalPortion > 0 && balance === 0) payoffMonth = m;
    yearPrincipal += principalPortion;
    yearInterest += interestPortion;

    if (m % 12 === 0) {
      rows.push({
        year: m / 12,
        principalPaid: clampDollars(yearPrincipal),
        interestPaid: clampDollars(yearInterest),
        balance: clampDollars(balance),
      });
      yearPrincipal = 0;
      yearInterest = 0;
    }
  }

  return { rows, payoffYears: payoffMonth !== null ? payoffMonth / 12 : null, initialPayment };
}

// Long-term capital gains on the home sale, after the IRS Section 121 primary-residence
// exclusion ($250k single / $500k married filing jointly). Uses a flat estimated rate rather
// than stacked federal brackets — simpler to reason about for a "how does selling affect my
// cash" estimate, at the cost of some precision for high earners near a bracket boundary.
export function computeCapitalGains({ salePrice, sellingCosts, costBasis, filingStatus, capGainsRatePct }) {
  const exclusion = LONG_TERM_CAP_GAINS_EXCLUSION[filingStatus] ?? LONG_TERM_CAP_GAINS_EXCLUSION.single;
  const gain = Math.max(pctOf(salePrice) - pctOf(sellingCosts) - pctOf(costBasis), 0);
  const taxableGain = Math.max(gain - exclusion, 0);
  const tax = clampDollars(taxableGain * (pctOf(capGainsRatePct) / 100));
  return { gain: clampDollars(gain), exclusion, taxableGain: clampDollars(taxableGain), tax };
}

// Net proceeds from selling the old home: sale price minus commission, seller closing costs,
// pre-sale repairs/staging, the remaining mortgage payoff, and estimated capital gains tax.
export function computeSellingProceeds(inputs) {
  const salePrice = pctOf(inputs.oldHomeValue);
  const oldMortgagePayoff = pctOf(inputs.oldMortgageBalance);
  const commission = clampDollars(salePrice * (pctOf(inputs.realtorCommissionPct) / 100));
  const sellerClosingCosts = clampDollars(salePrice * (pctOf(inputs.sellerClosingCostPct) / 100));
  const repairs = pctOf(inputs.repairsStagingFlat);
  const sellingCostsTotal = clampDollars(commission + sellerClosingCosts + repairs);
  const capGains = computeCapitalGains({
    salePrice,
    sellingCosts: sellingCostsTotal,
    costBasis: pctOf(inputs.costBasis),
    filingStatus: inputs.filingStatus,
    capGainsRatePct: inputs.capGainsRatePct,
  });
  const netProceeds = clampDollars(salePrice - sellingCostsTotal - oldMortgagePayoff - capGains.tax);
  return { salePrice, commission, sellerClosingCosts, repairs, sellingCostsTotal, oldMortgagePayoff, capGains, netProceeds };
}

// Cash actually available toward the new purchase depends on timing: if the old home has
// already sold (or sells simultaneously), its net proceeds are in hand. If the new home closes
// first (buy-before-sell), those proceeds aren't available yet — a bridge loan/HELOC against
// the old home's equity stands in for them until the sale closes.
export function computeFundsAvailable(inputs, sellingProceeds) {
  const additionalSavings = pctOf(inputs.additionalSavings);
  const buyBeforeSell = inputs.timingMode === "buyBeforeSell";
  const bridgeLoanAmount = buyBeforeSell ? pctOf(inputs.bridgeLoanAmount) : 0;
  const netProceedsAvailable = buyBeforeSell ? 0 : sellingProceeds.netProceeds;
  const total = clampDollars(netProceedsAvailable + additionalSavings + bridgeLoanAmount);
  return { netProceedsAvailable, additionalSavings, bridgeLoanAmount, total };
}

// The new mortgage: down payment, loan amount, PMI (auto-applied under 20% equity), points,
// ARM/fixed, and the full monthly payment including taxes/insurance/HOA/PMI.
export function computeBuySide(inputs, fundsAvailable) {
  const price = pctOf(inputs.newHomePrice);
  const downPayment = Math.min(Math.max(Number(inputs.downPayment) || 0, 0), price);
  const loanAmount = clampDollars(Math.max(price - downPayment, 0));
  const buyerClosingCosts = clampDollars(price * (pctOf(inputs.buyerClosingCostPct) / 100));
  const prepaidEscrow = pctOf(inputs.prepaidEscrowFlat);
  const points = pctOf(inputs.discountPoints);
  const pointsCost = clampDollars(loanAmount * (points / 100));
  const effectiveRatePct = Math.max((Number(inputs.newMortgageRatePct) || 0) - points * POINT_RATE_REDUCTION, 0);
  const termYears = clampYears(inputs.newLoanTermYears) || 30;
  const isArm = inputs.loanType === "arm";
  const arm = isArm
    ? { initialPeriodYears: clampYears(inputs.armInitialPeriodYears) || 5, postRatePct: Math.max(Number(inputs.armPostAdjustRatePct) || 0, 0) }
    : null;
  const payment = computeMonthlyPayment(loanAmount, effectiveRatePct, termYears * 12);
  const downPct = price > 0 ? (downPayment / price) * 100 : 0;
  const pmiRatePct = pctOf(inputs.pmiRatePct);
  const pmiMonthly = downPct < 20 ? clampDollars((loanAmount * (pmiRatePct / 100)) / 12) : 0;
  const propertyTaxMonthly = clampDollars((price * (pctOf(inputs.newPropertyTaxPct) / 100)) / 12);
  const insuranceMonthly = clampDollars(pctOf(inputs.newHomeInsuranceAnnual) / 12);
  const hoaMonthly = pctOf(inputs.newHoaMonthly);
  const totalMonthly = clampDollars(payment + pmiMonthly + propertyTaxMonthly + insuranceMonthly + hoaMonthly);
  const totalCashRequired = clampDollars(downPayment + buyerClosingCosts + prepaidEscrow + pointsCost);
  const cashGap = clampDollars(fundsAvailable - totalCashRequired);

  return {
    price, downPayment, downPct, loanAmount, buyerClosingCosts, prepaidEscrow, pointsCost,
    effectiveRatePct, termYears, arm, payment, pmiMonthly, propertyTaxMonthly, insuranceMonthly,
    hoaMonthly, totalMonthly, totalCashRequired, cashGap,
  };
}

// The old mortgage's current all-in monthly cost, for the headline old-vs-new comparison.
export function computeOldMonthlyPayment(inputs) {
  const balance = pctOf(inputs.oldMortgageBalance);
  const rate = Number(inputs.oldMortgageRatePct) || 0;
  const remainingYears = clampYears(inputs.oldMortgageRemainingYears);
  const payment = computeMonthlyPayment(balance, rate, remainingYears * 12);
  const propertyTaxMonthly = clampDollars((pctOf(inputs.oldHomeValue) * (pctOf(inputs.oldPropertyTaxPct) / 100)) / 12);
  const insuranceMonthly = clampDollars(pctOf(inputs.oldHomeInsuranceAnnual) / 12);
  const hoaMonthly = pctOf(inputs.oldHoaMonthly);
  const totalMonthly = clampDollars(payment + propertyTaxMonthly + insuranceMonthly + hoaMonthly);
  return { payment, propertyTaxMonthly, insuranceMonthly, hoaMonthly, totalMonthly, balance, rate, remainingYears };
}

// Extra cost of carrying both the old and new mortgage (plus bridge-loan interest) during a
// buy-before-sell overlap, until the old home actually sells and pays off the bridge.
export function computeBridgeCarryCost(inputs, oldPayment, newPayment) {
  if (inputs.timingMode !== "buyBeforeSell") return null;
  const overlapMonths = clampMonths(inputs.overlapMonths, MAX_OVERLAP_MONTHS);
  const bridgeLoanAmount = pctOf(inputs.bridgeLoanAmount);
  const bridgeRatePct = pctOf(inputs.bridgeLoanRatePct);
  const bridgeMonthlyInterest = clampDollars((bridgeLoanAmount * (bridgeRatePct / 100)) / 12);
  const totalOverlapCost = clampDollars((oldPayment.totalMonthly + newPayment.totalMonthly + bridgeMonthlyInterest) * overlapMonths);
  return { overlapMonths, bridgeMonthlyInterest, totalOverlapCost };
}

// Temporary housing cost for a sell-then-buy gap (old home sold, new home not closed yet).
export function computeGapHousingCost(inputs) {
  if (inputs.timingMode !== "sellThenBuy") return null;
  const gapMonths = clampMonths(inputs.gapMonths, MAX_OVERLAP_MONTHS);
  const tempMonthly = pctOf(inputs.tempHousingMonthly);
  return { gapMonths, totalCost: clampDollars(gapMonths * tempMonthly) };
}

// Side-by-side monthly payment at several candidate rates (points ignored — this isolates the
// effect of rate alone), for the "how does the rate I actually get change things" comparison.
export function computeRateScenarios(inputs, fundsAvailable, rates) {
  return rates
    .filter((r) => Number.isFinite(r) && r >= 0)
    .map((ratePct) => {
      const buy = computeBuySide({ ...inputs, newMortgageRatePct: ratePct, discountPoints: 0 }, fundsAvailable);
      return { ratePct, payment: buy.payment, totalMonthly: buy.totalMonthly };
    });
}

// Full sensitivity grid across a rate range and a set of loan terms. Row/column counts are
// capped (MAX_SENSITIVITY_ROWS, and a floored minimum step) so a malformed or extreme
// min/max/step input can't blow this up into an enormous grid.
export function computeRateSensitivityTable(inputs, fundsAvailable, { minRate, maxRate, step, terms }) {
  const lo = Math.max(Number(minRate) || 0, 0);
  const hiRaw = Math.max(Number(maxRate) || 0, lo);
  const stepSafe = Math.max(Number(step) || 0.25, 0.05);
  const rawCount = Math.floor((hiRaw - lo) / stepSafe) + 1;
  const count = Math.min(Math.max(rawCount, 1), MAX_SENSITIVITY_ROWS);
  const rates = Array.from({ length: count }, (_, i) => Math.round((lo + i * stepSafe) * 1000) / 1000);

  return terms.map((term) => ({
    term,
    rows: rates.map((ratePct) => {
      const buy = computeBuySide({ ...inputs, newMortgageRatePct: ratePct, newLoanTermYears: term, discountPoints: 0 }, fundsAvailable);
      return { ratePct, payment: buy.payment, totalMonthly: buy.totalMonthly };
    }),
  }));
}

// How many months of lower payments it takes discount points to pay for themselves, vs. not
// paying points at all (same rate before the point-driven reduction).
export function computePointsBreakeven(inputs, fundsAvailable) {
  const withPoints = computeBuySide(inputs, fundsAvailable);
  const withoutPoints = computeBuySide({ ...inputs, discountPoints: 0 }, fundsAvailable);
  const monthlySavings = withoutPoints.payment - withPoints.payment;
  const breakevenMonths = monthlySavings > 0.01 ? withPoints.pointsCost / monthlySavings : null;
  return { pointsCost: withPoints.pointsCost, monthlySavings, breakevenMonths };
}

// Home equity over time under two scenarios: staying in (and continuing to pay down) the old
// home, vs. buying the new one — both appreciating at the same assumed rate, for a like-for-like
// comparison of how equity builds either way.
export function computeEquityOverTime(inputs, buySide, years) {
  const projYears = clampYears(years);
  const appreciationPct = Number(inputs.homeAppreciationPct) || 0;
  const oldValue0 = pctOf(inputs.oldHomeValue);
  const newValue0 = pctOf(inputs.newHomePrice);

  const oldAmort = buildAmortization({
    loanAmount: pctOf(inputs.oldMortgageBalance),
    ratePct: Number(inputs.oldMortgageRatePct) || 0,
    termYears: clampYears(inputs.oldMortgageRemainingYears),
    projectionYears: projYears,
  });
  const newAmort = buildAmortization({
    loanAmount: buySide.loanAmount,
    ratePct: buySide.effectiveRatePct,
    termYears: buySide.termYears,
    projectionYears: projYears,
    arm: buySide.arm,
  });

  const oldBalanceAt = (y) => (oldAmort.rows.find((r) => r.year === y) ?? oldAmort.rows[oldAmort.rows.length - 1])?.balance ?? 0;
  const newBalanceAt = (y) => (newAmort.rows.find((r) => r.year === y) ?? newAmort.rows[newAmort.rows.length - 1])?.balance ?? 0;

  const rows = [];
  for (let y = 0; y <= projYears; y++) {
    const oldVal = clampDollars(oldValue0 * Math.pow(1 + appreciationPct / 100, y));
    const newVal = clampDollars(newValue0 * Math.pow(1 + appreciationPct / 100, y));
    rows.push({
      year: y,
      oldHomeValue: oldVal,
      newHomeValue: newVal,
      oldHomeEquity: clampDollars(oldVal - oldBalanceAt(y)),
      newHomeEquity: clampDollars(newVal - newBalanceAt(y)),
    });
  }
  return rows;
}

// Estimated year equity in the new home first reaches 20% (when PMI would typically drop off),
// via the same amortization + appreciation assumptions as the equity-over-time chart above.
export function estimatePmiRemovalYear(inputs, buySide) {
  if (buySide.downPct >= 20) return 0;
  const appreciationPct = Number(inputs.homeAppreciationPct) || 0;
  const newAmort = buildAmortization({
    loanAmount: buySide.loanAmount, ratePct: buySide.effectiveRatePct, termYears: buySide.termYears,
    projectionYears: buySide.termYears, arm: buySide.arm,
  });
  const price0 = pctOf(inputs.newHomePrice);
  for (const row of newAmort.rows) {
    const value = clampDollars(price0 * Math.pow(1 + appreciationPct / 100, row.year));
    if (value > 0 && (value - row.balance) / value >= 0.2) return row.year;
  }
  return null;
}
