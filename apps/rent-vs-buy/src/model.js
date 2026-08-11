// Rent-vs-buy comparison using the standard "opportunity cost of capital" methodology:
// both scenarios start from the same cash position (what a buyer would spend upfront), and
// whoever has the lower cash outflow in a given month invests the difference at the assumed
// market return. Net worth after N years = home equity (minus selling costs) + any side
// investments for the buyer, vs. the renter's investment portfolio alone. This is the same
// basic approach used by the well-known NYT/NYU-Stern-style calculators, reimplemented here
// from the underlying methodology, not from their code or copy.

// Per CLAUDE.md's crash-proofing checklist: every compounding loop is clamped to a sane
// ceiling and every monetary value is clamped to a finite bound, so extreme or malformed
// inputs can't overflow into Infinity/NaN and crash the chart or freeze the tab.
export const MAX_YEARS = 100;
export const MAX_DOLLARS = 1e12;
const SALT_CAP_ANNUAL = 10000; // federal cap on the deductible portion of property tax
const POINT_RATE_REDUCTION = 0.25; // percentage points of rate reduced per discount point — a common industry rule of thumb, not a lender-specific quote

function clampYears(y) {
  const n = Math.trunc(Number(y));
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), MAX_YEARS);
}

export function clampDollars(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(Math.max(v, -MAX_DOLLARS), MAX_DOLLARS);
}

// Converts an annual rate to its monthly-compounding equivalent via (1+r)^(1/12) - 1. Floors
// the annual factor at a small positive number first — a fractional power of a negative base
// (an annual rate below -100%) is NaN in JS, and that NaN would otherwise flow straight into
// the chart data and crash it exactly like the unbounded-loop bug this pattern is meant to
// prevent. A home/investment can't really lose more than 100% of its value anyway.
function monthlyRateFromAnnual(annualPct) {
  const factor = Math.max(1 + Number(annualPct) / 100, 1e-6);
  return Math.pow(factor, 1 / 12) - 1;
}

export function monthlyMortgagePayment(loanAmount, annualRatePct, termYears) {
  const n = clampYears(termYears) * 12;
  const r = Number(annualRatePct) / 100 / 12;
  if (n <= 0 || loanAmount <= 0) return 0;
  if (Math.abs(r) < 1e-9) return clampDollars(loanAmount / n);
  const factor = Math.pow(1 + r, n);
  if (!Number.isFinite(factor) || factor <= 1) return clampDollars(loanAmount * r); // extreme-rate fallback
  return clampDollars((loanAmount * (r * factor)) / (factor - 1));
}

export function simulateRentVsBuy(inputs) {
  const homePrice = Math.max(Number(inputs.homePrice) || 0, 0);
  const downPaymentPct = Math.min(Math.max(Number(inputs.downPaymentPct) || 0, 0), 100);
  const mortgageRatePct = Number(inputs.mortgageRatePct) || 0;
  const mortgageTermYears = clampYears(inputs.mortgageTermYears);
  const homeAppreciationPct = Number(inputs.homeAppreciationPct) || 0;
  const propertyTaxPct = Math.max(Number(inputs.propertyTaxPct) || 0, 0);
  const homeInsuranceAnnual = Math.max(Number(inputs.homeInsuranceAnnual) || 0, 0);
  const maintenancePct = Math.max(Number(inputs.maintenancePct) || 0, 0);
  const hoaMonthlyInput = Math.max(Number(inputs.hoaMonthly) || 0, 0);
  const costInflationPct = Number(inputs.costInflationPct) || 0;
  const closingCostBuyPct = Math.max(Number(inputs.closingCostBuyPct) || 0, 0);
  const closingCostSellPct = Math.max(Number(inputs.closingCostSellPct) || 0, 0);
  const pmiPct = Math.max(Number(inputs.pmiPct) || 0, 0);
  const discountPoints = Math.max(Number(inputs.discountPoints) || 0, 0);
  const extraPrincipalMonthly = Math.max(Number(inputs.extraPrincipalMonthly) || 0, 0);
  const monthlyRent = Math.max(Number(inputs.monthlyRent) || 0, 0);
  const rentGrowthPct = Number(inputs.rentGrowthPct) || 0;
  const rentersInsuranceMonthly = Math.max(Number(inputs.rentersInsuranceMonthly) || 0, 0);
  const investmentReturnPct = Number(inputs.investmentReturnPct) || 0;
  const marginalTaxRatePct = Math.min(Math.max(Number(inputs.marginalTaxRatePct) || 0, 0), 100);
  const standardDeductionAnnual = Math.max(Number(inputs.standardDeductionAnnual) || 0, 0);
  const itemizeDeductions = !!inputs.itemizeDeductions;
  const years = clampYears(inputs.yearsToStay);
  const months = years * 12;

  const downPayment = clampDollars(homePrice * (downPaymentPct / 100));
  const loanAmount = clampDollars(Math.max(homePrice - downPayment, 0));
  const buyingClosingCosts = clampDollars(homePrice * (closingCostBuyPct / 100));
  const effectiveMortgageRatePct = Math.max(mortgageRatePct - discountPoints * POINT_RATE_REDUCTION, 0);
  const pointsCost = clampDollars(loanAmount * (discountPoints / 100));
  const payment = monthlyMortgagePayment(loanAmount, effectiveMortgageRatePct, mortgageTermYears);
  const monthlyMortgageRate = effectiveMortgageRatePct / 100 / 12;

  const monthlyAppreciation = monthlyRateFromAnnual(homeAppreciationPct);
  const monthlyRentGrowth = monthlyRateFromAnnual(rentGrowthPct);
  const monthlyInvestmentReturn = monthlyRateFromAnnual(investmentReturnPct);
  const monthlyCostInflation = monthlyRateFromAnnual(costInflationPct);

  let mortgageBalance = loanAmount;
  let homeValue = homePrice;
  let rent = monthlyRent;
  let insuranceAnnual = homeInsuranceAnnual;
  let hoaMonthlyValue = hoaMonthlyInput;
  let buyerInvestments = 0;
  let renterInvestments = clampDollars(downPayment + buyingClosingCosts + pointsCost);

  const rows = [{
    year: 0,
    homeValue: clampDollars(homeValue),
    mortgageBalance: clampDollars(mortgageBalance),
    homeEquity: clampDollars(homeValue - mortgageBalance),
    buyerNetWorth: clampDollars(homeValue - mortgageBalance - homeValue * (closingCostSellPct / 100) + buyerInvestments),
    renterNetWorth: clampDollars(renterInvestments),
    principalPaid: 0,
    interestPaid: 0,
  }];

  let firstMonthOwnCost = null;
  let firstMonthRentCost = null;
  let firstMonthHousingCostForDTI = null;
  let payoffMonth = null;
  let yearPrincipal = 0;
  let yearInterest = 0;

  for (let m = 1; m <= months; m++) {
    homeValue = clampDollars(homeValue * (1 + monthlyAppreciation));

    const loanActive = mortgageBalance > 0;
    const interestPortion = loanActive ? mortgageBalance * monthlyMortgageRate : 0;
    const scheduledPrincipal = loanActive ? Math.min(Math.max(payment - interestPortion, 0), mortgageBalance) : 0;
    const extraPrincipal = loanActive ? Math.min(extraPrincipalMonthly, Math.max(mortgageBalance - scheduledPrincipal, 0)) : 0;
    mortgageBalance = clampDollars(Math.max(mortgageBalance - scheduledPrincipal - extraPrincipal, 0));
    if (payoffMonth === null && loanActive && mortgageBalance === 0) payoffMonth = m;
    yearPrincipal += scheduledPrincipal + extraPrincipal;
    yearInterest += interestPortion;

    const propertyTaxMonthly = (homeValue * (propertyTaxPct / 100)) / 12;
    const insuranceMonthly = insuranceAnnual / 12;
    const maintenanceMonthly = (homeValue * (maintenancePct / 100)) / 12;
    const equityFraction = homeValue > 0 ? (homeValue - mortgageBalance) / homeValue : 1;
    const pmiMonthly = equityFraction < 0.2 ? (mortgageBalance * (pmiPct / 100)) / 12 : 0;
    const requiredMortgagePayment = loanActive ? (interestPortion + scheduledPrincipal) : 0;

    // What a lender would actually count toward DTI: the required (non-extra) payment plus
    // taxes/insurance/HOA/PMI — not maintenance (not a debt payment) and not voluntary extra
    // principal (not required).
    const housingCostForDTI = requiredMortgagePayment + propertyTaxMonthly + insuranceMonthly + hoaMonthlyValue + pmiMonthly;
    const ownCashOutflow = requiredMortgagePayment + extraPrincipal + propertyTaxMonthly + insuranceMonthly + maintenanceMonthly + hoaMonthlyValue + pmiMonthly;

    let taxBenefitMonthly = 0;
    if (itemizeDeductions) {
      const itemizedAnnualized = (interestPortion + Math.min(propertyTaxMonthly, SALT_CAP_ANNUAL / 12)) * 12;
      const excessOverStandard = Math.max(itemizedAnnualized - standardDeductionAnnual, 0);
      taxBenefitMonthly = (excessOverStandard * (marginalTaxRatePct / 100)) / 12;
    }
    const netOwnCost = ownCashOutflow - taxBenefitMonthly;
    const rentCost = rent + rentersInsuranceMonthly;

    if (firstMonthOwnCost === null) {
      firstMonthOwnCost = netOwnCost;
      firstMonthRentCost = rentCost;
      firstMonthHousingCostForDTI = housingCostForDTI;
    }

    if (netOwnCost > rentCost) {
      renterInvestments += (netOwnCost - rentCost);
    } else {
      buyerInvestments += (rentCost - netOwnCost);
    }
    buyerInvestments = clampDollars(buyerInvestments * (1 + monthlyInvestmentReturn));
    renterInvestments = clampDollars(renterInvestments * (1 + monthlyInvestmentReturn));
    rent = clampDollars(rent * (1 + monthlyRentGrowth));
    insuranceAnnual = clampDollars(insuranceAnnual * (1 + monthlyCostInflation));
    hoaMonthlyValue = clampDollars(hoaMonthlyValue * (1 + monthlyCostInflation));

    if (m % 12 === 0) {
      const sellingCosts = homeValue * (closingCostSellPct / 100);
      rows.push({
        year: m / 12,
        homeValue: clampDollars(homeValue),
        mortgageBalance: clampDollars(mortgageBalance),
        homeEquity: clampDollars(homeValue - mortgageBalance),
        buyerNetWorth: clampDollars(homeValue - mortgageBalance - sellingCosts + buyerInvestments),
        renterNetWorth: clampDollars(renterInvestments),
        principalPaid: clampDollars(yearPrincipal),
        interestPaid: clampDollars(yearInterest),
      });
      yearPrincipal = 0;
      yearInterest = 0;
    }
  }

  const final = rows[rows.length - 1];
  const netWorthGap = final.buyerNetWorth - final.renterNetWorth; // positive => buying ahead
  const finalFavorsBuy = netWorthGap >= 0;
  const initialGap = rows[0].buyerNetWorth - rows[0].renterNetWorth;
  const initialFavorsBuy = initialGap >= 0;

  let breakevenYear = null;
  if (initialFavorsBuy !== finalFavorsBuy) {
    for (const r of rows) {
      const gap = r.buyerNetWorth - r.renterNetWorth;
      if (finalFavorsBuy ? gap >= 0 : gap <= 0) {
        breakevenYear = r.year;
        break;
      }
    }
  }

  return {
    rows,
    final,
    netWorthGap,
    breakevenYear,
    monthlyPayment: payment,
    effectiveMortgageRatePct,
    pointsCost,
    loanAmount,
    downPayment,
    buyingClosingCosts,
    firstMonthOwnCost,
    firstMonthRentCost,
    firstMonthHousingCostForDTI,
    payoffYears: payoffMonth !== null ? payoffMonth / 12 : null,
  };
}

// For each field in `fieldRanges`, nudges it upward by 5% of its slider range and re-runs the
// simulation to see whether that increases or decreases the buy/rent net-worth gap — i.e.
// whether *more* of that input currently helps buying or renting, given every other input's
// present value. This isn't fixed per field: e.g. a bigger down payment can favor buying or
// renting depending on the spread between the mortgage rate and the assumed investment return,
// so it has to be recomputed against the live inputs rather than hardcoded once. Used purely to
// orient each slider's gradient direction — "which way currently helps buying" — not to change
// the math of the result itself.
export function computeSliderDirections(inputs, fieldRanges, baseGap) {
  const directions = {};
  for (const [field, range] of Object.entries(fieldRanges)) {
    const span = range.max - range.min;
    const bump = span > 0 ? span * 0.05 : 1;
    const current = Number(inputs[field]) || 0;
    const nudgedGap = simulateRentVsBuy({ ...inputs, [field]: current + bump }).netWorthGap;
    // Ties (nudgedGap === baseGap) default to "buy" — this only happens when the field is
    // currently inert, e.g. PMI's rate has zero effect whenever equity is already >= 20% and
    // never drops below it. Harmless: an inert field showing either color isn't factually
    // wrong, since neither direction is actually true when the field doesn't affect anything.
    directions[field] = nudgedGap >= baseGap ? "buy" : "rent";
  }
  return directions;
}

// Standard conventional-loan affordability guideline: front-end ratio (housing cost alone)
// at or under 28% of gross monthly income, back-end ratio (housing + all other debt) at or
// under 36%. Actual lenders vary and often go higher with compensating factors — this is a
// general rule of thumb, not a lending decision, and the UI says so.
export function computeAffordability(monthlyHousingCost, monthlyOtherDebts, annualIncome) {
  const monthlyIncome = Math.max(Number(annualIncome) || 0, 0) / 12;
  const debts = Math.max(Number(monthlyOtherDebts) || 0, 0);
  const housing = Math.max(Number(monthlyHousingCost) || 0, 0);
  if (monthlyIncome <= 0) {
    return { frontEndDTI: 0, backEndDTI: 0, frontEndOk: null, backEndOk: null, monthlyIncome: 0 };
  }
  const frontEndDTI = (housing / monthlyIncome) * 100;
  const backEndDTI = ((housing + debts) / monthlyIncome) * 100;
  return {
    frontEndDTI,
    backEndDTI,
    frontEndOk: frontEndDTI <= 28,
    backEndOk: backEndDTI <= 36,
    monthlyIncome,
  };
}
