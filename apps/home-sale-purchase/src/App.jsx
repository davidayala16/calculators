import { useMemo, useState, useEffect, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  computeSellingProceeds, computeFundsAvailable, computeBuySide, computeOldMonthlyPayment,
  computeBridgeCarryCost, computeGapHousingCost, computeRateScenarios, computeRateSensitivityTable,
  computePointsBreakeven, computeEquityOverTime, estimatePmiRemovalYear, buildAmortization,
} from './model.js';

const INK = "#12141C";
const PANEL = "#1B1F2B";
const PANEL_2 = "#161923";
const GRID = "#2C3142";
const PARCHMENT = "#EAEAF2";
const MUTED = "#8B90A8";
const OLD = "#7B8AA6";
const NEW = "#3FAE7A";
const WARN = "#E0B03B";
const DANGER = "#D9604A";

const AUTOSAVE_KEY = "home-sale-purchase:autosave-v1";

function fmtMoney(n, compact = false) {
  if (!Number.isFinite(n)) return "$0";
  const v = Math.round(n);
  if (compact && Math.abs(v) >= 1000) return (v < 0 ? "-$" : "$") + (Math.abs(v) / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 }) + "k";
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString();
}
function fmtPct(n, digits = 2) { return `${Number(n).toFixed(digits)}%`; }

const DEFAULTS = {
  // Old home you're selling
  oldHomeValue: 500000, oldMortgageBalance: 300000, oldMortgageRatePct: 5.5, oldMortgageRemainingYears: 25,
  oldPropertyTaxPct: 1.1, oldHomeInsuranceAnnual: 1800, oldHoaMonthly: 0,
  // Selling costs & taxes
  realtorCommissionPct: 6, sellerClosingCostPct: 1.5, repairsStagingFlat: 5000,
  costBasis: 350000, filingStatus: "single", capGainsRatePct: 15,
  // New home
  newHomePrice: 600000, additionalSavings: 0, downPayment: 120000,
  buyerClosingCostPct: 3, prepaidEscrowFlat: 4000,
  newPropertyTaxPct: 1.1, newHomeInsuranceAnnual: 2000, newHoaMonthly: 0, pmiRatePct: 0.6,
  // Loan options
  newMortgageRatePct: 6.5, newLoanTermYears: 30, loanType: "fixed",
  armInitialPeriodYears: 5, armPostAdjustRatePct: 8, discountPoints: 0,
  // Timing
  timingMode: "simultaneous", gapMonths: 2, tempHousingMonthly: 2500,
  bridgeLoanAmount: 100000, bridgeLoanRatePct: 8.5, overlapMonths: 3,
  // Appreciation & comparison horizon
  homeAppreciationPct: 3.5, comparisonYears: 10,
  // Rate sensitivity grid
  sensMinRate: 5, sensMaxRate: 8.5, sensStep: 0.5,
};

function CollapsibleHeader({ label, expandedKey, expanded, toggle }) {
  return (
    <button className="hsp-collapsible-header" onClick={() => toggle(expandedKey)}>
      <span>{label}</span>
      <span className="hsp-caret" style={{ transform: expanded[expandedKey] ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
    </button>
  );
}

function Field({ label, value, onChange, suffix, help, type = "number", step }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <span className="hsp-field-label">{label}{suffix ? ` (${suffix})` : ""}</span>
      <input type={type} step={step} value={value} onChange={(e) => onChange(e.target.value)} />
      {help && <div className="hsp-field-help">{help}</div>}
    </div>
  );
}

function HomeSalePurchaseCalculator() {
  // Old home
  const [oldHomeValue, setOldHomeValue] = useState(DEFAULTS.oldHomeValue);
  const [oldMortgageBalance, setOldMortgageBalance] = useState(DEFAULTS.oldMortgageBalance);
  const [oldMortgageRatePct, setOldMortgageRatePct] = useState(DEFAULTS.oldMortgageRatePct);
  const [oldMortgageRemainingYears, setOldMortgageRemainingYears] = useState(DEFAULTS.oldMortgageRemainingYears);
  const [oldPropertyTaxPct, setOldPropertyTaxPct] = useState(DEFAULTS.oldPropertyTaxPct);
  const [oldHomeInsuranceAnnual, setOldHomeInsuranceAnnual] = useState(DEFAULTS.oldHomeInsuranceAnnual);
  const [oldHoaMonthly, setOldHoaMonthly] = useState(DEFAULTS.oldHoaMonthly);
  // Selling costs & taxes
  const [realtorCommissionPct, setRealtorCommissionPct] = useState(DEFAULTS.realtorCommissionPct);
  const [sellerClosingCostPct, setSellerClosingCostPct] = useState(DEFAULTS.sellerClosingCostPct);
  const [repairsStagingFlat, setRepairsStagingFlat] = useState(DEFAULTS.repairsStagingFlat);
  const [costBasis, setCostBasis] = useState(DEFAULTS.costBasis);
  const [filingStatus, setFilingStatus] = useState(DEFAULTS.filingStatus);
  const [capGainsRatePct, setCapGainsRatePct] = useState(DEFAULTS.capGainsRatePct);
  // New home
  const [newHomePrice, setNewHomePrice] = useState(DEFAULTS.newHomePrice);
  const [additionalSavings, setAdditionalSavings] = useState(DEFAULTS.additionalSavings);
  const [downPayment, setDownPayment] = useState(DEFAULTS.downPayment);
  const [buyerClosingCostPct, setBuyerClosingCostPct] = useState(DEFAULTS.buyerClosingCostPct);
  const [prepaidEscrowFlat, setPrepaidEscrowFlat] = useState(DEFAULTS.prepaidEscrowFlat);
  const [newPropertyTaxPct, setNewPropertyTaxPct] = useState(DEFAULTS.newPropertyTaxPct);
  const [newHomeInsuranceAnnual, setNewHomeInsuranceAnnual] = useState(DEFAULTS.newHomeInsuranceAnnual);
  const [newHoaMonthly, setNewHoaMonthly] = useState(DEFAULTS.newHoaMonthly);
  const [pmiRatePct, setPmiRatePct] = useState(DEFAULTS.pmiRatePct);
  // Loan options
  const [newMortgageRatePct, setNewMortgageRatePct] = useState(DEFAULTS.newMortgageRatePct);
  const [newLoanTermYears, setNewLoanTermYears] = useState(DEFAULTS.newLoanTermYears);
  const [loanType, setLoanType] = useState(DEFAULTS.loanType);
  const [armInitialPeriodYears, setArmInitialPeriodYears] = useState(DEFAULTS.armInitialPeriodYears);
  const [armPostAdjustRatePct, setArmPostAdjustRatePct] = useState(DEFAULTS.armPostAdjustRatePct);
  const [discountPoints, setDiscountPoints] = useState(DEFAULTS.discountPoints);
  // Timing
  const [timingMode, setTimingMode] = useState(DEFAULTS.timingMode);
  const [gapMonths, setGapMonths] = useState(DEFAULTS.gapMonths);
  const [tempHousingMonthly, setTempHousingMonthly] = useState(DEFAULTS.tempHousingMonthly);
  const [bridgeLoanAmount, setBridgeLoanAmount] = useState(DEFAULTS.bridgeLoanAmount);
  const [bridgeLoanRatePct, setBridgeLoanRatePct] = useState(DEFAULTS.bridgeLoanRatePct);
  const [overlapMonths, setOverlapMonths] = useState(DEFAULTS.overlapMonths);
  // Appreciation & horizon
  const [homeAppreciationPct, setHomeAppreciationPct] = useState(DEFAULTS.homeAppreciationPct);
  const [comparisonYears, setComparisonYears] = useState(DEFAULTS.comparisonYears);
  // Rate sensitivity grid
  const [sensMinRate, setSensMinRate] = useState(DEFAULTS.sensMinRate);
  const [sensMaxRate, setSensMaxRate] = useState(DEFAULTS.sensMaxRate);
  const [sensStep, setSensStep] = useState(DEFAULTS.sensStep);

  const [expanded, setExpanded] = useState({
    oldHome: true, selling: true, newHome: true, loan: true,
    timing: false, appreciation: false, rateScenarios: true, sensitivity: false, sensitivityTable: false,
    amortization: false, equity: true, about: false,
  });
  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const hydrated = useRef(false);
  const saveTimer = useRef(null);
  const skipNextSave = useRef(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareUrlDisplay, setShareUrlDisplay] = useState(null);

  const applyProfile = (p) => {
    if (p.oldHomeValue !== undefined) setOldHomeValue(p.oldHomeValue);
    if (p.oldMortgageBalance !== undefined) setOldMortgageBalance(p.oldMortgageBalance);
    if (p.oldMortgageRatePct !== undefined) setOldMortgageRatePct(p.oldMortgageRatePct);
    if (p.oldMortgageRemainingYears !== undefined) setOldMortgageRemainingYears(p.oldMortgageRemainingYears);
    if (p.oldPropertyTaxPct !== undefined) setOldPropertyTaxPct(p.oldPropertyTaxPct);
    if (p.oldHomeInsuranceAnnual !== undefined) setOldHomeInsuranceAnnual(p.oldHomeInsuranceAnnual);
    if (p.oldHoaMonthly !== undefined) setOldHoaMonthly(p.oldHoaMonthly);
    if (p.realtorCommissionPct !== undefined) setRealtorCommissionPct(p.realtorCommissionPct);
    if (p.sellerClosingCostPct !== undefined) setSellerClosingCostPct(p.sellerClosingCostPct);
    if (p.repairsStagingFlat !== undefined) setRepairsStagingFlat(p.repairsStagingFlat);
    if (p.costBasis !== undefined) setCostBasis(p.costBasis);
    if (p.filingStatus !== undefined) setFilingStatus(p.filingStatus);
    if (p.capGainsRatePct !== undefined) setCapGainsRatePct(p.capGainsRatePct);
    if (p.newHomePrice !== undefined) setNewHomePrice(p.newHomePrice);
    if (p.additionalSavings !== undefined) setAdditionalSavings(p.additionalSavings);
    if (p.downPayment !== undefined) setDownPayment(p.downPayment);
    if (p.buyerClosingCostPct !== undefined) setBuyerClosingCostPct(p.buyerClosingCostPct);
    if (p.prepaidEscrowFlat !== undefined) setPrepaidEscrowFlat(p.prepaidEscrowFlat);
    if (p.newPropertyTaxPct !== undefined) setNewPropertyTaxPct(p.newPropertyTaxPct);
    if (p.newHomeInsuranceAnnual !== undefined) setNewHomeInsuranceAnnual(p.newHomeInsuranceAnnual);
    if (p.newHoaMonthly !== undefined) setNewHoaMonthly(p.newHoaMonthly);
    if (p.pmiRatePct !== undefined) setPmiRatePct(p.pmiRatePct);
    if (p.newMortgageRatePct !== undefined) setNewMortgageRatePct(p.newMortgageRatePct);
    if (p.newLoanTermYears !== undefined) setNewLoanTermYears(p.newLoanTermYears);
    if (p.loanType !== undefined) setLoanType(p.loanType);
    if (p.armInitialPeriodYears !== undefined) setArmInitialPeriodYears(p.armInitialPeriodYears);
    if (p.armPostAdjustRatePct !== undefined) setArmPostAdjustRatePct(p.armPostAdjustRatePct);
    if (p.discountPoints !== undefined) setDiscountPoints(p.discountPoints);
    if (p.timingMode !== undefined) setTimingMode(p.timingMode);
    if (p.gapMonths !== undefined) setGapMonths(p.gapMonths);
    if (p.tempHousingMonthly !== undefined) setTempHousingMonthly(p.tempHousingMonthly);
    if (p.bridgeLoanAmount !== undefined) setBridgeLoanAmount(p.bridgeLoanAmount);
    if (p.bridgeLoanRatePct !== undefined) setBridgeLoanRatePct(p.bridgeLoanRatePct);
    if (p.overlapMonths !== undefined) setOverlapMonths(p.overlapMonths);
    if (p.homeAppreciationPct !== undefined) setHomeAppreciationPct(p.homeAppreciationPct);
    if (p.comparisonYears !== undefined) setComparisonYears(p.comparisonYears);
    if (p.sensMinRate !== undefined) setSensMinRate(p.sensMinRate);
    if (p.sensMaxRate !== undefined) setSensMaxRate(p.sensMaxRate);
    if (p.sensStep !== undefined) setSensStep(p.sensStep);
  };

  const profileSnapshot = {
    oldHomeValue, oldMortgageBalance, oldMortgageRatePct, oldMortgageRemainingYears,
    oldPropertyTaxPct, oldHomeInsuranceAnnual, oldHoaMonthly,
    realtorCommissionPct, sellerClosingCostPct, repairsStagingFlat, costBasis, filingStatus, capGainsRatePct,
    newHomePrice, additionalSavings, downPayment, buyerClosingCostPct, prepaidEscrowFlat,
    newPropertyTaxPct, newHomeInsuranceAnnual, newHoaMonthly, pmiRatePct,
    newMortgageRatePct, newLoanTermYears, loanType, armInitialPeriodYears, armPostAdjustRatePct, discountPoints,
    timingMode, gapMonths, tempHousingMonthly, bridgeLoanAmount, bridgeLoanRatePct, overlapMonths,
    homeAppreciationPct, comparisonYears, sensMinRate, sensMaxRate, sensStep,
  };

  const encodeProfile = (obj) => {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); } catch { return null; }
  };
  const decodeProfile = (str) => JSON.parse(decodeURIComponent(escape(atob(str))));

  const buildShareUrl = () => {
    const encoded = encodeProfile(profileSnapshot);
    if (!encoded) return null;
    const url = new URL(window.location.href);
    url.searchParams.set("d", encoded);
    return url.toString();
  };

  const copyShareLink = async () => {
    const url = buildShareUrl();
    if (!url) return;
    setShareUrlDisplay(url);
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // clipboard blocked (common in sandboxed previews) — the visible box below still works
    }
  };

  // Persistence: a shared link always wins over this browser's autosave (see CLAUDE.md).
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const d = params.get("d");
      if (d) {
        applyProfile(decodeProfile(d));
      } else {
        const saved = localStorage.getItem(AUTOSAVE_KEY);
        if (saved) applyProfile(JSON.parse(saved));
      }
    } catch {
      // bad link or corrupted local save — start fresh
    }
    hydrated.current = true;
  }, []);

  // Debounced autosave — never the URL itself (see CLAUDE.md for why that broke retirement-runway).
  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Suppressed exactly once right after "Start fresh" — without this, the state change from
    // applyProfile(DEFAULTS) below would still trigger this same effect and silently resurrect
    // a freshly-cleared autosave 400ms later with the default profile.
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(profileSnapshot));
      } catch {
        // storage unavailable/full (private browsing, quota) — silently skip
      }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [profileSnapshot]);

  const resetToDefaults = () => {
    if (!window.confirm("Clear all inputs and start fresh? This can't be undone.")) return;
    skipNextSave.current = true;
    applyProfile(DEFAULTS);
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
  };

  const inputs = profileSnapshot;

  const sellingProceeds = useMemo(() => computeSellingProceeds(inputs), [inputs]);

  const fundsAvailable = useMemo(() => computeFundsAvailable(inputs, sellingProceeds), [inputs, sellingProceeds]);

  const buySide = useMemo(() => computeBuySide(inputs, fundsAvailable.total), [inputs, fundsAvailable]);

  const oldPayment = useMemo(() => computeOldMonthlyPayment(inputs), [inputs]);

  const bridgeCarry = useMemo(() => computeBridgeCarryCost(inputs, oldPayment, buySide), [inputs, oldPayment, buySide]);

  const gapHousing = useMemo(() => computeGapHousingCost(inputs), [inputs]);

  const scenarioRates = useMemo(() => {
    const base = Number(newMortgageRatePct) || 0;
    return [base - 1, base - 0.5, base, base + 0.5, base + 1].filter((r) => r >= 0.1);
  }, [newMortgageRatePct]);

  const rateScenarios = useMemo(() => computeRateScenarios(inputs, fundsAvailable.total, scenarioRates), [
    inputs, fundsAvailable, scenarioRates,
  ]);

  const sensitivityTable = useMemo(() => computeRateSensitivityTable(inputs, fundsAvailable.total, {
    minRate: sensMinRate, maxRate: sensMaxRate, step: sensStep, terms: [15, 30],
  }), [inputs, fundsAvailable, sensMinRate, sensMaxRate, sensStep]);

  const pointsBreakeven = useMemo(() => computePointsBreakeven(inputs, fundsAvailable.total), [inputs, fundsAvailable]);

  const equityRows = useMemo(() => computeEquityOverTime(inputs, buySide, comparisonYears), [
    inputs, buySide, comparisonYears,
  ]);

  const pmiRemovalYear = useMemo(() => estimatePmiRemovalYear(inputs, buySide), [inputs, buySide]);

  const oldAmort = useMemo(() => buildAmortization({
    loanAmount: oldPayment.balance, ratePct: oldPayment.rate, termYears: oldPayment.remainingYears,
    projectionYears: oldPayment.remainingYears,
  }), [oldPayment]);

  const newAmort = useMemo(() => buildAmortization({
    loanAmount: buySide.loanAmount, ratePct: buySide.effectiveRatePct, termYears: buySide.termYears,
    projectionYears: buySide.termYears, arm: buySide.arm,
  }), [buySide]);

  const monthlyDelta = buySide.totalMonthly - oldPayment.totalMonthly;
  const paysMore = monthlyDelta >= 0;
  const cashPositive = buySide.cashGap >= 0;

  return (
    <div style={{ minHeight: "100vh", background: INK, color: PARCHMENT, fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        .hsp-serif { font-family: 'Fraunces', serif; }
        .hsp-mono { font-family: 'IBM Plex Mono', monospace; }
        input[type="number"], input[type="text"] {
          background: ${PANEL_2}; border: 1px solid ${GRID}; color: ${PARCHMENT};
          border-radius: 3px; padding: 7px 9px; font-family: 'IBM Plex Mono', monospace;
          font-size: 13px; width: 100%; box-sizing: border-box;
        }
        input:focus { outline: none; border-color: ${NEW}; }
        .hsp-toggle { border: 1px solid ${GRID}; background: transparent; color: ${MUTED}; padding: 8px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; cursor: pointer; }
        .hsp-toggle.active { background: ${NEW}; border-color: ${NEW}; color: ${INK}; font-weight: 600; }
        .hsp-field-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: ${MUTED}; display: block; margin-bottom: 5px; }
        .hsp-field-help { font-size: 11px; color: ${MUTED}; margin-top: 5px; line-height: 1.5; }
        .hsp-section-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .1em; color: ${MUTED}; margin-bottom: 12px; }
        .hsp-collapsible-header {
          font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .1em; color: ${MUTED};
          margin-bottom: 12px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;
          background: transparent; border: none; width: 100%; padding: 0; text-align: left;
        }
        .hsp-collapsible-header:hover { color: ${NEW}; }
        .hsp-caret { font-size: 10px; transition: transform 0.15s ease; }
        .hsp-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${GRID}; align-items: center; gap: 8px; }
        .hsp-row:last-child { border-bottom: none; }
        .hsp-card { border: 1px solid ${GRID}; border-radius: 4px; padding: 14px; }
        @media (max-width: 780px) { .hsp-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      <div style={{ borderBottom: `1px solid ${GRID}`, padding: "28px 24px 24px", background: `linear-gradient(180deg, ${PANEL_2} 0%, ${INK} 100%)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
          <div className="hsp-mono" style={{ fontSize: "11px", letterSpacing: "0.14em", color: NEW }}>
            SELL YOUR HOME &amp; BUY THE NEXT ONE
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button className="hsp-toggle" style={{ fontSize: "11px", padding: "6px 10px" }} onClick={copyShareLink}>
              {linkCopied ? "✓ Link copied!" : "🔗 Copy shareable link"}
            </button>
            <button className="hsp-toggle" style={{ fontSize: "11px", padding: "6px 10px", color: DANGER, borderColor: DANGER }} onClick={resetToDefaults}>Start fresh</button>
          </div>
        </div>

        {shareUrlDisplay && (
          <div style={{ border: `1px solid ${NEW}`, borderRadius: "4px", padding: "10px", marginBottom: "14px", background: PANEL_2, display: "flex", gap: "8px", alignItems: "center" }}>
            <input readOnly value={shareUrlDisplay} onFocus={(e) => e.target.select()} className="hsp-mono" style={{ flex: 1, fontSize: "11px" }} />
            <button className="hsp-toggle" style={{ fontSize: "11px", padding: "6px 10px", flexShrink: 0 }} onClick={() => setShareUrlDisplay(null)}>Close</button>
          </div>
        )}

        <h1 className="hsp-serif" style={{ fontSize: "30px", fontWeight: 600, margin: "0 0 6px 0" }}>
          Sell &amp; Buy
        </h1>
        <p style={{ color: MUTED, fontSize: "14px", margin: 0, maxWidth: "640px" }}>
          Sell your current home, buy the next one, and see exactly how selling costs, your new
          rate, and where the down payment comes from change your monthly payment versus what
          you pay today.
        </p>
        <p className="hsp-mono" style={{ color: MUTED, fontSize: "11px", margin: "10px 0 0 0", maxWidth: "640px", lineHeight: 1.6 }}>
          Autosaves in this browser as you go. Tap "Copy shareable link" to bookmark or send a specific scenario.
        </p>

        <div style={{ marginTop: "22px", display: "flex", gap: "40px", flexWrap: "wrap" }}>
          <div>
            <div className="hsp-field-label">New monthly payment vs. today</div>
            <div className="hsp-serif" style={{ fontSize: "34px", fontWeight: 700, color: paysMore ? WARN : NEW, lineHeight: 1.2 }}>
              {paysMore ? "+" : "-"}{fmtMoney(Math.abs(monthlyDelta))}/mo
            </div>
            <div style={{ fontSize: "12px", color: MUTED, marginTop: "4px" }}>
              {fmtMoney(oldPayment.totalMonthly)}/mo today → {fmtMoney(buySide.totalMonthly)}/mo on the new place
            </div>
          </div>
          <div>
            <div className="hsp-field-label">Cash needed at closing</div>
            <div className="hsp-serif" style={{ fontSize: "34px", fontWeight: 700, color: cashPositive ? NEW : DANGER, lineHeight: 1.2 }}>
              {cashPositive ? fmtMoney(buySide.cashGap) + " left over" : fmtMoney(Math.abs(buySide.cashGap)) + " short"}
            </div>
            <div style={{ fontSize: "12px", color: MUTED, marginTop: "4px" }}>
              {fmtMoney(buySide.totalCashRequired)} required vs. {fmtMoney(fundsAvailable.total)} available
            </div>
          </div>
        </div>
      </div>

      <div className="hsp-grid" style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 0 }}>
        <div style={{ padding: "24px", borderRight: `1px solid ${GRID}`, background: PANEL }}>
          <CollapsibleHeader label="YOUR CURRENT HOME" expandedKey="oldHome" expanded={expanded} toggle={toggle} />
          {expanded.oldHome && (
            <>
              <Field label="Estimated sale price" value={oldHomeValue} onChange={setOldHomeValue} />
              <Field label="Remaining mortgage balance" value={oldMortgageBalance} onChange={setOldMortgageBalance} />
              <Field label="Current mortgage rate" value={oldMortgageRatePct} onChange={setOldMortgageRatePct} suffix="%" step="0.125" />
              <Field label="Years remaining on the loan" value={oldMortgageRemainingYears} onChange={setOldMortgageRemainingYears} suffix="yrs" />
              <Field label="Property tax" value={oldPropertyTaxPct} onChange={setOldPropertyTaxPct} suffix="%/yr of value" step="0.05" />
              <Field label="Homeowners insurance" value={oldHomeInsuranceAnnual} onChange={setOldHomeInsuranceAnnual} suffix="$/yr" />
              <Field label="HOA dues" value={oldHoaMonthly} onChange={setOldHoaMonthly} suffix="$/mo" />
              <div style={{ fontSize: "11px", color: MUTED, lineHeight: 1.6 }}>
                Today's all-in payment: <strong style={{ color: PARCHMENT }}>{fmtMoney(oldPayment.totalMonthly)}/mo</strong>
              </div>
            </>
          )}

          <div style={{ marginTop: "22px" }}>
            <CollapsibleHeader label="SELLING COSTS &amp; TAXES" expandedKey="selling" expanded={expanded} toggle={toggle} />
          </div>
          {expanded.selling && (
            <>
              <Field label="Realtor commission" value={realtorCommissionPct} onChange={setRealtorCommissionPct} suffix="%" step="0.25" />
              <Field label="Seller closing costs" value={sellerClosingCostPct} onChange={setSellerClosingCostPct} suffix="%" step="0.25"
                help="Title, escrow, transfer taxes, attorney fees." />
              <Field label="Repairs / staging / prep" value={repairsStagingFlat} onChange={setRepairsStagingFlat} suffix="$ flat" />
              <Field label="Original cost basis" value={costBasis} onChange={setCostBasis}
                help="Original purchase price plus capital improvements — used to estimate the taxable gain." />
              <div style={{ marginBottom: "14px" }}>
                <span className="hsp-field-label">Tax filing status</span>
                <div style={{ display: "flex" }}>
                  <button className={`hsp-toggle ${filingStatus === "single" ? "active" : ""}`} style={{ flex: 1, borderRight: "none" }} onClick={() => setFilingStatus("single")}>Single (÷250k exempt)</button>
                  <button className={`hsp-toggle ${filingStatus === "joint" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setFilingStatus("joint")}>Joint (÷500k exempt)</button>
                </div>
              </div>
              <Field label="Est. capital gains rate" value={capGainsRatePct} onChange={setCapGainsRatePct} suffix="%" step="1"
                help="Applied only to gain above the primary-residence exclusion." />
              <div className="hsp-card" style={{ marginTop: "10px" }}>
                <div className="hsp-row"><span style={{ fontSize: "12px" }}>Sale price</span><span className="hsp-mono" style={{ fontSize: "12px" }}>{fmtMoney(sellingProceeds.salePrice)}</span></div>
                <div className="hsp-row"><span style={{ fontSize: "12px" }}>Commission + closing + repairs</span><span className="hsp-mono" style={{ fontSize: "12px" }}>-{fmtMoney(sellingProceeds.sellingCostsTotal)}</span></div>
                <div className="hsp-row"><span style={{ fontSize: "12px" }}>Mortgage payoff</span><span className="hsp-mono" style={{ fontSize: "12px" }}>-{fmtMoney(sellingProceeds.oldMortgagePayoff)}</span></div>
                <div className="hsp-row"><span style={{ fontSize: "12px" }}>Capital gains tax{sellingProceeds.capGains.taxableGain <= 0 ? " (under exclusion)" : ""}</span><span className="hsp-mono" style={{ fontSize: "12px" }}>-{fmtMoney(sellingProceeds.capGains.tax)}</span></div>
                <div className="hsp-row"><span style={{ fontSize: "13px", fontWeight: 600 }}>Net proceeds</span><span className="hsp-mono" style={{ fontSize: "14px", fontWeight: 700, color: NEW }}>{fmtMoney(sellingProceeds.netProceeds)}</span></div>
              </div>
            </>
          )}

          <div style={{ marginTop: "22px" }}>
            <CollapsibleHeader label="THE NEW HOME" expandedKey="newHome" expanded={expanded} toggle={toggle} />
          </div>
          {expanded.newHome && (
            <>
              <Field label="Purchase price" value={newHomePrice} onChange={setNewHomePrice} />
              <Field label="Down payment" value={downPayment} onChange={setDownPayment}
                help={`${fmtPct(buySide.downPct)} of price. Loan amount: ${fmtMoney(buySide.loanAmount)}.`} />
              <Field label="Additional savings toward down payment" value={additionalSavings} onChange={setAdditionalSavings}
                help="Cash beyond your home sale proceeds, counted in funds available below." />
              <Field label="Buyer closing costs" value={buyerClosingCostPct} onChange={setBuyerClosingCostPct} suffix="%" step="0.25"
                help="Loan origination, appraisal, title insurance, escrow." />
              <Field label="Prepaid escrow / upfront reserves" value={prepaidEscrowFlat} onChange={setPrepaidEscrowFlat} suffix="$ flat"
                help="Prepaid property tax/insurance reserves plus any upfront mortgage-insurance premium." />
              <Field label="Property tax" value={newPropertyTaxPct} onChange={setNewPropertyTaxPct} suffix="%/yr of price" step="0.05" />
              <Field label="Homeowners insurance" value={newHomeInsuranceAnnual} onChange={setNewHomeInsuranceAnnual} suffix="$/yr" />
              <Field label="HOA dues" value={newHoaMonthly} onChange={setNewHoaMonthly} suffix="$/mo" />
              <Field label="PMI rate (if down payment &lt; 20%)" value={pmiRatePct} onChange={setPmiRatePct} suffix="%/yr of loan" step="0.05"
                help={buySide.downPct < 20
                  ? `Applies: ${fmtMoney(buySide.pmiMonthly)}/mo${pmiRemovalYear !== null ? `, until equity reaches 20% around year ${pmiRemovalYear}` : ""}.`
                  : "Down payment is 20%+, so PMI doesn't apply."} />
            </>
          )}

          <div style={{ marginTop: "22px" }}>
            <CollapsibleHeader label="LOAN OPTIONS" expandedKey="loan" expanded={expanded} toggle={toggle} />
          </div>
          {expanded.loan && (
            <>
              <Field label="Mortgage rate" value={newMortgageRatePct} onChange={setNewMortgageRatePct} suffix="%" step="0.125" />
              <div style={{ marginBottom: "14px" }}>
                <span className="hsp-field-label">Loan term</span>
                <div style={{ display: "flex" }}>
                  <button className={`hsp-toggle ${Number(newLoanTermYears) === 15 ? "active" : ""}`} style={{ flex: 1, borderRight: "none" }} onClick={() => setNewLoanTermYears(15)}>15 year</button>
                  <button className={`hsp-toggle ${Number(newLoanTermYears) === 30 ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setNewLoanTermYears(30)}>30 year</button>
                </div>
              </div>
              <div style={{ marginBottom: "14px" }}>
                <span className="hsp-field-label">Rate type</span>
                <div style={{ display: "flex" }}>
                  <button className={`hsp-toggle ${loanType === "fixed" ? "active" : ""}`} style={{ flex: 1, borderRight: "none" }} onClick={() => setLoanType("fixed")}>Fixed</button>
                  <button className={`hsp-toggle ${loanType === "arm" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setLoanType("arm")}>ARM</button>
                </div>
              </div>
              {loanType === "arm" && (
                <>
                  <div style={{ marginBottom: "14px" }}>
                    <span className="hsp-field-label">Initial fixed period</span>
                    <div style={{ display: "flex" }}>
                      <button className={`hsp-toggle ${Number(armInitialPeriodYears) === 5 ? "active" : ""}`} style={{ flex: 1, borderRight: "none" }} onClick={() => setArmInitialPeriodYears(5)}>5/1 ARM</button>
                      <button className={`hsp-toggle ${Number(armInitialPeriodYears) === 7 ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setArmInitialPeriodYears(7)}>7/1 ARM</button>
                    </div>
                  </div>
                  <Field label="Assumed rate after adjustment" value={armPostAdjustRatePct} onChange={setArmPostAdjustRatePct} suffix="%" step="0.125" />
                </>
              )}
              <Field label="Discount points" value={discountPoints} onChange={setDiscountPoints} suffix="pts" step="0.125"
                help={discountPoints > 0
                  ? `${fmtMoney(pointsBreakeven.pointsCost)} upfront gets you ${fmtPct(newMortgageRatePct)} → ${fmtPct(buySide.effectiveRatePct)}${pointsBreakeven.breakevenMonths !== null ? `; breaks even in ~${Math.round(pointsBreakeven.breakevenMonths)} months` : ""}.`
                  : "1 point = 1% of your loan amount, paid upfront to buy down the rate (~0.25%/point)."} />
              <div style={{ fontSize: "11px", color: MUTED, lineHeight: 1.6 }}>
                Principal &amp; interest: <strong style={{ color: PARCHMENT }}>{fmtMoney(buySide.payment)}/mo</strong>
              </div>
            </>
          )}

          <div style={{ marginTop: "22px" }}>
            <CollapsibleHeader label="TIMING SCENARIO" expandedKey="timing" expanded={expanded} toggle={toggle} />
          </div>
          {expanded.timing && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
                <button className={`hsp-toggle ${timingMode === "simultaneous" ? "active" : ""}`} onClick={() => setTimingMode("simultaneous")}>Simultaneous close</button>
                <button className={`hsp-toggle ${timingMode === "sellThenBuy" ? "active" : ""}`} onClick={() => setTimingMode("sellThenBuy")}>Sell, then buy</button>
                <button className={`hsp-toggle ${timingMode === "buyBeforeSell" ? "active" : ""}`} onClick={() => setTimingMode("buyBeforeSell")}>Buy before selling</button>
              </div>
              {timingMode === "simultaneous" && (
                <div style={{ fontSize: "11px", color: MUTED, lineHeight: 1.6 }}>Both close the same day — sale proceeds flow directly into the new purchase, no overlap costs.</div>
              )}
              {timingMode === "sellThenBuy" && (
                <>
                  <Field label="Gap between closings" value={gapMonths} onChange={setGapMonths} suffix="months"
                    help="If you need temporary housing between selling and buying." />
                  <Field label="Temporary housing cost" value={tempHousingMonthly} onChange={setTempHousingMonthly} suffix="$/mo" />
                  {gapHousing && gapHousing.totalCost > 0 && (
                    <div style={{ fontSize: "11px", color: MUTED }}>Total temporary housing: {fmtMoney(gapHousing.totalCost)}</div>
                  )}
                </>
              )}
              {timingMode === "buyBeforeSell" && (
                <>
                  <Field label="Bridge loan / HELOC amount" value={bridgeLoanAmount} onChange={setBridgeLoanAmount}
                    help="Borrowed against your current home's equity to fund the new down payment before it sells." />
                  <Field label="Bridge loan rate" value={bridgeLoanRatePct} onChange={setBridgeLoanRatePct} suffix="%" step="0.25" />
                  <Field label="Months carrying both mortgages" value={overlapMonths} onChange={setOverlapMonths} suffix="months" />
                  {bridgeCarry && (
                    <div style={{ fontSize: "11px", color: MUTED, lineHeight: 1.6 }}>
                      Carrying both payments + interest-only bridge: ~{fmtMoney(bridgeCarry.bridgeMonthlyInterest + oldPayment.totalMonthly + buySide.totalMonthly)}/mo
                      for {bridgeCarry.overlapMonths} months (~{fmtMoney(bridgeCarry.totalOverlapCost)} total), until the old home sells and pays off the bridge.
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div style={{ marginTop: "22px" }}>
            <CollapsibleHeader label="APPRECIATION &amp; COMPARISON HORIZON" expandedKey="appreciation" expanded={expanded} toggle={toggle} />
          </div>
          {expanded.appreciation && (
            <>
              <Field label="Home price appreciation" value={homeAppreciationPct} onChange={setHomeAppreciationPct} suffix="%/yr" step="0.25"
                help="Applied to both the old and new home for the equity chart below." />
              <Field label="Comparison horizon" value={comparisonYears} onChange={setComparisonYears} suffix="years" />
            </>
          )}

          <div style={{ marginTop: "22px" }}>
            <CollapsibleHeader label="RATE SENSITIVITY GRID SETTINGS" expandedKey="sensitivity" expanded={expanded} toggle={toggle} />
          </div>
          {expanded.sensitivity && (
            <>
              <Field label="Lowest rate to show" value={sensMinRate} onChange={setSensMinRate} suffix="%" step="0.25" />
              <Field label="Highest rate to show" value={sensMaxRate} onChange={setSensMaxRate} suffix="%" step="0.25" />
              <Field label="Step size" value={sensStep} onChange={setSensStep} suffix="%" step="0.05" />
            </>
          )}
        </div>

        <div style={{ padding: "24px" }}>
          <div className="hsp-section-label">MONTH ONE, SIDE BY SIDE</div>
          <div style={{ display: "flex", gap: "16px", marginBottom: "30px", flexWrap: "wrap" }}>
            <div className="hsp-card" style={{ flex: 1, minWidth: "220px", borderColor: OLD }}>
              <div className="hsp-field-label">Your current home</div>
              <div className="hsp-serif" style={{ fontSize: "24px", fontWeight: 700, color: OLD }}>{fmtMoney(oldPayment.totalMonthly)}/mo</div>
              <div style={{ fontSize: "11px", color: MUTED, marginTop: "8px", lineHeight: 1.6 }}>
                {fmtMoney(oldPayment.payment)} P&amp;I + {fmtMoney(oldPayment.propertyTaxMonthly)} tax + {fmtMoney(oldPayment.insuranceMonthly)} insurance{oldPayment.hoaMonthly > 0 ? ` + ${fmtMoney(oldPayment.hoaMonthly)} HOA` : ""}
              </div>
            </div>
            <div className="hsp-card" style={{ flex: 1, minWidth: "220px", borderColor: NEW }}>
              <div className="hsp-field-label">Your new home</div>
              <div className="hsp-serif" style={{ fontSize: "24px", fontWeight: 700, color: NEW }}>{fmtMoney(buySide.totalMonthly)}/mo</div>
              <div style={{ fontSize: "11px", color: MUTED, marginTop: "8px", lineHeight: 1.6 }}>
                {fmtMoney(buySide.payment)} P&amp;I + {fmtMoney(buySide.propertyTaxMonthly)} tax + {fmtMoney(buySide.insuranceMonthly)} insurance
                {buySide.pmiMonthly > 0 ? ` + ${fmtMoney(buySide.pmiMonthly)} PMI` : ""}{buySide.hoaMonthly > 0 ? ` + ${fmtMoney(buySide.hoaMonthly)} HOA` : ""}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: "30px" }}>
            <div className="hsp-section-label">CASH NEEDED AT CLOSING</div>
            <div className="hsp-card">
              <div className="hsp-row"><span style={{ fontSize: "12px" }}>Down payment</span><span className="hsp-mono" style={{ fontSize: "12px" }}>{fmtMoney(buySide.downPayment)}</span></div>
              <div className="hsp-row"><span style={{ fontSize: "12px" }}>Buyer closing costs</span><span className="hsp-mono" style={{ fontSize: "12px" }}>{fmtMoney(buySide.buyerClosingCosts)}</span></div>
              <div className="hsp-row"><span style={{ fontSize: "12px" }}>Prepaid escrow / reserves</span><span className="hsp-mono" style={{ fontSize: "12px" }}>{fmtMoney(buySide.prepaidEscrow)}</span></div>
              {discountPoints > 0 && <div className="hsp-row"><span style={{ fontSize: "12px" }}>Discount points</span><span className="hsp-mono" style={{ fontSize: "12px" }}>{fmtMoney(buySide.pointsCost)}</span></div>}
              <div className="hsp-row"><span style={{ fontSize: "13px", fontWeight: 600 }}>Total required</span><span className="hsp-mono" style={{ fontSize: "13px", fontWeight: 700 }}>{fmtMoney(buySide.totalCashRequired)}</span></div>
              <div className="hsp-row" style={{ borderTop: `1px solid ${GRID}`, marginTop: "6px", paddingTop: "10px" }}><span style={{ fontSize: "12px" }}>Home sale net proceeds{timingMode === "buyBeforeSell" ? " (not yet available)" : ""}</span><span className="hsp-mono" style={{ fontSize: "12px" }}>{fmtMoney(fundsAvailable.netProceedsAvailable)}</span></div>
              <div className="hsp-row"><span style={{ fontSize: "12px" }}>Additional savings</span><span className="hsp-mono" style={{ fontSize: "12px" }}>{fmtMoney(fundsAvailable.additionalSavings)}</span></div>
              {timingMode === "buyBeforeSell" && <div className="hsp-row"><span style={{ fontSize: "12px" }}>Bridge loan / HELOC</span><span className="hsp-mono" style={{ fontSize: "12px" }}>{fmtMoney(fundsAvailable.bridgeLoanAmount)}</span></div>}
              <div className="hsp-row"><span style={{ fontSize: "13px", fontWeight: 600 }}>Total available</span><span className="hsp-mono" style={{ fontSize: "13px", fontWeight: 700 }}>{fmtMoney(fundsAvailable.total)}</span></div>
              <div className="hsp-row" style={{ borderTop: `1px solid ${GRID}`, marginTop: "6px", paddingTop: "10px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>{cashPositive ? "Left over" : "Shortfall"}</span>
                <span className="hsp-mono" style={{ fontSize: "16px", fontWeight: 700, color: cashPositive ? NEW : DANGER }}>{fmtMoney(Math.abs(buySide.cashGap))}</span>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: "30px" }}>
            <CollapsibleHeader label="RATE SCENARIOS, SIDE BY SIDE" expandedKey="rateScenarios" expanded={expanded} toggle={toggle} />
            {expanded.rateScenarios && (
              <div style={{ border: `1px solid ${GRID}`, borderRadius: "4px", overflow: "hidden" }}>
                <div className="hsp-row hsp-mono" style={{ background: PANEL_2, fontSize: "11px", color: MUTED, textTransform: "uppercase", padding: "10px 12px" }}>
                  <span style={{ flex: 1 }}>Rate</span>
                  <span style={{ flex: 2, textAlign: "right" }}>P&amp;I</span>
                  <span style={{ flex: 2, textAlign: "right" }}>All-in monthly</span>
                  <span style={{ flex: 2, textAlign: "right" }}>vs. today</span>
                </div>
                {rateScenarios.map((s) => (
                  <div key={s.ratePct} className="hsp-row hsp-mono" style={{ fontSize: "12px", padding: "8px 12px", background: Math.abs(s.ratePct - Number(newMortgageRatePct)) < 0.01 ? PANEL_2 : "transparent" }}>
                    <span style={{ flex: 1 }}>{fmtPct(s.ratePct)}</span>
                    <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(s.payment)}</span>
                    <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(s.totalMonthly)}</span>
                    <span style={{ flex: 2, textAlign: "right", color: s.totalMonthly >= oldPayment.totalMonthly ? WARN : NEW }}>
                      {s.totalMonthly >= oldPayment.totalMonthly ? "+" : "-"}{fmtMoney(Math.abs(s.totalMonthly - oldPayment.totalMonthly))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: "30px" }}>
            <CollapsibleHeader label="FULL RATE SENSITIVITY TABLE" expandedKey="sensitivityTable" expanded={expanded} toggle={toggle} />
            {expanded.sensitivityTable && (
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                {sensitivityTable.map((termTable) => (
                  <div key={termTable.term} style={{ flex: 1, minWidth: "220px", border: `1px solid ${GRID}`, borderRadius: "4px", overflow: "hidden" }}>
                    <div className="hsp-row hsp-mono" style={{ background: PANEL_2, fontSize: "11px", color: MUTED, textTransform: "uppercase", padding: "10px 12px" }}>
                      <span>{termTable.term}-year term</span><span>All-in monthly</span>
                    </div>
                    <div style={{ maxHeight: "280px", overflowY: "auto" }}>
                      {termTable.rows.map((r) => (
                        <div key={r.ratePct} className="hsp-row hsp-mono" style={{ fontSize: "12px", padding: "7px 12px" }}>
                          <span>{fmtPct(r.ratePct)}</span><span>{fmtMoney(r.totalMonthly)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: "30px" }}>
            <CollapsibleHeader label={`HOME EQUITY — YEAR 0 TO ${comparisonYears}`} expandedKey="equity" expanded={expanded} toggle={toggle} />
            {expanded.equity && (
              <>
                <div style={{ fontSize: "11px", color: MUTED, marginBottom: "12px", lineHeight: 1.6 }}>
                  Equity if you'd kept the old home vs. equity in the new home, both appreciating at {fmtPct(homeAppreciationPct)}/yr.
                </div>
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <LineChart data={equityRows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="year" stroke={MUTED} tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: MUTED }} tickLine={false} />
                      <YAxis stroke={MUTED} tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: MUTED }} tickFormatter={(v) => fmtMoney(v, true)} tickLine={false} width={56} />
                      <Tooltip contentStyle={{ background: PANEL_2, border: `1px solid ${GRID}`, borderRadius: "4px", fontFamily: "IBM Plex Mono", fontSize: "12px" }} labelFormatter={(y) => `Year ${y}`} formatter={(v, name) => [fmtMoney(v), name === "oldHomeEquity" ? "Old home" : "New home"]} />
                      <Legend wrapperStyle={{ fontFamily: "IBM Plex Mono", fontSize: "11px" }} formatter={(v) => (v === "oldHomeEquity" ? "Old home (if kept)" : "New home")} />
                      <Line type="monotone" dataKey="oldHomeEquity" stroke={OLD} strokeWidth={3} dot={false} />
                      <Line type="monotone" dataKey="newHomeEquity" stroke={NEW} strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>

          <div style={{ marginBottom: "10px" }}>
            <CollapsibleHeader label="AMORTIZATION SCHEDULE — OLD VS. NEW" expandedKey="amortization" expanded={expanded} toggle={toggle} />
            {expanded.amortization && (
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "260px" }}>
                  <div className="hsp-field-label" style={{ marginBottom: "8px" }}>
                    Old mortgage{oldAmort.payoffYears !== null ? ` (payoff ~year ${oldAmort.payoffYears.toFixed(1)})` : ""}
                  </div>
                  <div style={{ border: `1px solid ${GRID}`, borderRadius: "4px", overflow: "hidden", maxHeight: "320px", overflowY: "auto" }}>
                    <div className="hsp-row hsp-mono" style={{ background: PANEL_2, fontSize: "11px", color: MUTED, textTransform: "uppercase", padding: "9px 12px", position: "sticky", top: 0 }}>
                      <span style={{ flex: 1 }}>Yr</span><span style={{ flex: 2, textAlign: "right" }}>Principal</span><span style={{ flex: 2, textAlign: "right" }}>Interest</span><span style={{ flex: 2, textAlign: "right" }}>Balance</span>
                    </div>
                    {oldAmort.rows.slice(1).map((r) => (
                      <div key={r.year} className="hsp-row hsp-mono" style={{ fontSize: "12px", padding: "7px 12px" }}>
                        <span style={{ flex: 1 }}>{r.year}</span>
                        <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(r.principalPaid)}</span>
                        <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(r.interestPaid)}</span>
                        <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(r.balance)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: "260px" }}>
                  <div className="hsp-field-label" style={{ marginBottom: "8px" }}>
                    New mortgage{newAmort.payoffYears !== null ? ` (payoff ~year ${newAmort.payoffYears.toFixed(1)})` : ""}
                  </div>
                  <div style={{ border: `1px solid ${GRID}`, borderRadius: "4px", overflow: "hidden", maxHeight: "320px", overflowY: "auto" }}>
                    <div className="hsp-row hsp-mono" style={{ background: PANEL_2, fontSize: "11px", color: MUTED, textTransform: "uppercase", padding: "9px 12px", position: "sticky", top: 0 }}>
                      <span style={{ flex: 1 }}>Yr</span><span style={{ flex: 2, textAlign: "right" }}>Principal</span><span style={{ flex: 2, textAlign: "right" }}>Interest</span><span style={{ flex: 2, textAlign: "right" }}>Balance</span>
                    </div>
                    {newAmort.rows.slice(1).map((r) => (
                      <div key={r.year} className="hsp-row hsp-mono" style={{ fontSize: "12px", padding: "7px 12px" }}>
                        <span style={{ flex: 1 }}>{r.year}</span>
                        <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(r.principalPaid)}</span>
                        <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(r.interestPaid)}</span>
                        <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(r.balance)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: "30px", marginBottom: "10px" }}>
            <CollapsibleHeader label="HOW THIS IS CALCULATED" expandedKey="about" expanded={expanded} toggle={toggle} />
            {expanded.about && (
              <div style={{ fontSize: "12px", color: MUTED, lineHeight: 1.7 }}>
                <p>
                  Net proceeds from selling: sale price, minus realtor commission, seller closing
                  costs, and repairs/staging, minus your remaining mortgage payoff, minus any
                  estimated capital gains tax above the $250k (single) / $500k (joint)
                  primary-residence exclusion.
                </p>
                <p>
                  Those proceeds, plus any additional savings (plus a bridge loan if you're buying
                  before you sell), fund your down payment and buyer-side closing costs on the new
                  home. The new loan amount is the purchase price minus the down payment, and PMI
                  is added automatically whenever that down payment is under 20%.
                </p>
                <p>
                  The new monthly payment is principal &amp; interest at your chosen rate and term,
                  plus property tax, homeowners insurance, HOA dues, and PMI where it applies —
                  compared directly against what you're paying today on the old mortgage under the
                  same categories.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomeSalePurchaseCalculator;
