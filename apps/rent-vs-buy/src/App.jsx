import { useMemo, useState, useEffect, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import GradientSlider from './GradientSlider.jsx';
import { simulateRentVsBuy, computeSliderDirections, computeAffordability } from './model.js';

const INK = "#12141C";
const PANEL = "#1B1F2B";
const PANEL_2 = "#161923";
const GRID = "#2C3142";
const PARCHMENT = "#EAEAF2";
const MUTED = "#8B90A8";
const BUY = "#E2704A";
const RENT = "#4F8EF7";
const OK = "#4CAF7A";
const WARN = "#E0B03B";

const AUTOSAVE_KEY = "rent-vs-buy:autosave-v1";

function fmtMoney(n, compact = false) {
  if (!isFinite(n)) return "$0";
  const v = Math.round(n);
  if (compact && Math.abs(v) >= 1000) return "$" + (v / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 }) + "k";
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString();
}
function fmtPct(n) { return `${Number(n).toFixed(2)}%`; }

const DEFAULTS = {
  homePrice: 500000, downPaymentPct: 20, mortgageRatePct: 6.5, mortgageTermYears: 30,
  homeAppreciationPct: 3.5, monthlyRent: 2200, rentGrowthPct: 3, investmentReturnPct: 7,
  yearsToStay: 10,
  propertyTaxPct: 1.1, homeInsuranceAnnual: 1800, maintenancePct: 1, hoaMonthly: 0, pmiPct: 0.5,
  costInflationPct: 3,
  closingCostBuyPct: 3, closingCostSellPct: 6,
  discountPoints: 0, extraPrincipalMonthly: 0,
  rentersInsuranceMonthly: 15,
  marginalTaxRatePct: 24, standardDeductionAnnual: 29200, itemizeDeductions: false,
  annualIncome: 100000, monthlyOtherDebts: 0,
  uiMode: "basic",
};

// Shared with computeSliderDirections() so the sensitivity nudge always matches what's on
// screen — every slider below should pull its min/max from here rather than a hardcoded
// literal, so the two never drift apart.
const FIELD_RANGES = {
  homePrice: { min: 100000, max: 2000000 },
  downPaymentPct: { min: 0, max: 100 },
  mortgageRatePct: { min: 0, max: 12 },
  mortgageTermYears: { min: 10, max: 30 },
  monthlyRent: { min: 500, max: 10000 },
  yearsToStay: { min: 1, max: 40 },
  investmentReturnPct: { min: 0, max: 15 },
  homeAppreciationPct: { min: -5, max: 10 },
  propertyTaxPct: { min: 0, max: 4 },
  maintenancePct: { min: 0, max: 4 },
  pmiPct: { min: 0, max: 2 },
  costInflationPct: { min: 0, max: 8 },
  closingCostBuyPct: { min: 0, max: 8 },
  closingCostSellPct: { min: 0, max: 10 },
  discountPoints: { min: 0, max: 4 },
  extraPrincipalMonthly: { min: 0, max: 2000 },
  rentGrowthPct: { min: 0, max: 10 },
  marginalTaxRatePct: { min: 0, max: 50 },
};

function RentVsBuyCalculator() {
  const [homePrice, setHomePrice] = useState(DEFAULTS.homePrice);
  const [downPaymentPct, setDownPaymentPct] = useState(DEFAULTS.downPaymentPct);
  const [mortgageRatePct, setMortgageRatePct] = useState(DEFAULTS.mortgageRatePct);
  const [mortgageTermYears, setMortgageTermYears] = useState(DEFAULTS.mortgageTermYears);
  const [homeAppreciationPct, setHomeAppreciationPct] = useState(DEFAULTS.homeAppreciationPct);
  const [monthlyRent, setMonthlyRent] = useState(DEFAULTS.monthlyRent);
  const [rentGrowthPct, setRentGrowthPct] = useState(DEFAULTS.rentGrowthPct);
  const [investmentReturnPct, setInvestmentReturnPct] = useState(DEFAULTS.investmentReturnPct);
  const [yearsToStay, setYearsToStay] = useState(DEFAULTS.yearsToStay);

  const [propertyTaxPct, setPropertyTaxPct] = useState(DEFAULTS.propertyTaxPct);
  const [homeInsuranceAnnual, setHomeInsuranceAnnual] = useState(DEFAULTS.homeInsuranceAnnual);
  const [maintenancePct, setMaintenancePct] = useState(DEFAULTS.maintenancePct);
  const [hoaMonthly, setHoaMonthly] = useState(DEFAULTS.hoaMonthly);
  const [pmiPct, setPmiPct] = useState(DEFAULTS.pmiPct);
  const [costInflationPct, setCostInflationPct] = useState(DEFAULTS.costInflationPct);
  const [closingCostBuyPct, setClosingCostBuyPct] = useState(DEFAULTS.closingCostBuyPct);
  const [closingCostSellPct, setClosingCostSellPct] = useState(DEFAULTS.closingCostSellPct);
  const [discountPoints, setDiscountPoints] = useState(DEFAULTS.discountPoints);
  const [extraPrincipalMonthly, setExtraPrincipalMonthly] = useState(DEFAULTS.extraPrincipalMonthly);
  const [rentersInsuranceMonthly, setRentersInsuranceMonthly] = useState(DEFAULTS.rentersInsuranceMonthly);
  const [marginalTaxRatePct, setMarginalTaxRatePct] = useState(DEFAULTS.marginalTaxRatePct);
  const [standardDeductionAnnual, setStandardDeductionAnnual] = useState(DEFAULTS.standardDeductionAnnual);
  const [itemizeDeductions, setItemizeDeductions] = useState(DEFAULTS.itemizeDeductions);
  const [annualIncome, setAnnualIncome] = useState(DEFAULTS.annualIncome);
  const [monthlyOtherDebts, setMonthlyOtherDebts] = useState(DEFAULTS.monthlyOtherDebts);

  const [uiMode, setUiMode] = useState(DEFAULTS.uiMode);
  const [expanded, setExpanded] = useState({
    ownership: true, transaction: false, rental: false, tax: false, about: false,
    extraPayments: false, amortization: false, affordability: false,
  });
  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const hydrated = useRef(false);
  const saveTimer = useRef(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareUrlDisplay, setShareUrlDisplay] = useState(null);

  const applyProfile = (p) => {
    if (p.homePrice !== undefined) setHomePrice(p.homePrice);
    if (p.downPaymentPct !== undefined) setDownPaymentPct(p.downPaymentPct);
    if (p.mortgageRatePct !== undefined) setMortgageRatePct(p.mortgageRatePct);
    if (p.mortgageTermYears !== undefined) setMortgageTermYears(p.mortgageTermYears);
    if (p.homeAppreciationPct !== undefined) setHomeAppreciationPct(p.homeAppreciationPct);
    if (p.monthlyRent !== undefined) setMonthlyRent(p.monthlyRent);
    if (p.rentGrowthPct !== undefined) setRentGrowthPct(p.rentGrowthPct);
    if (p.investmentReturnPct !== undefined) setInvestmentReturnPct(p.investmentReturnPct);
    if (p.yearsToStay !== undefined) setYearsToStay(p.yearsToStay);
    if (p.propertyTaxPct !== undefined) setPropertyTaxPct(p.propertyTaxPct);
    if (p.homeInsuranceAnnual !== undefined) setHomeInsuranceAnnual(p.homeInsuranceAnnual);
    if (p.maintenancePct !== undefined) setMaintenancePct(p.maintenancePct);
    if (p.hoaMonthly !== undefined) setHoaMonthly(p.hoaMonthly);
    if (p.pmiPct !== undefined) setPmiPct(p.pmiPct);
    if (p.costInflationPct !== undefined) setCostInflationPct(p.costInflationPct);
    if (p.closingCostBuyPct !== undefined) setClosingCostBuyPct(p.closingCostBuyPct);
    if (p.closingCostSellPct !== undefined) setClosingCostSellPct(p.closingCostSellPct);
    if (p.discountPoints !== undefined) setDiscountPoints(p.discountPoints);
    if (p.extraPrincipalMonthly !== undefined) setExtraPrincipalMonthly(p.extraPrincipalMonthly);
    if (p.rentersInsuranceMonthly !== undefined) setRentersInsuranceMonthly(p.rentersInsuranceMonthly);
    if (p.marginalTaxRatePct !== undefined) setMarginalTaxRatePct(p.marginalTaxRatePct);
    if (p.standardDeductionAnnual !== undefined) setStandardDeductionAnnual(p.standardDeductionAnnual);
    if (p.itemizeDeductions !== undefined) setItemizeDeductions(p.itemizeDeductions);
    if (p.annualIncome !== undefined) setAnnualIncome(p.annualIncome);
    if (p.monthlyOtherDebts !== undefined) setMonthlyOtherDebts(p.monthlyOtherDebts);
    if (p.uiMode !== undefined) setUiMode(p.uiMode);
  };

  const encodeProfile = (obj) => {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); } catch (e) { return null; }
  };
  const decodeProfile = (str) => JSON.parse(decodeURIComponent(escape(atob(str))));

  const profileSnapshot = {
    homePrice, downPaymentPct, mortgageRatePct, mortgageTermYears, homeAppreciationPct,
    monthlyRent, rentGrowthPct, investmentReturnPct, yearsToStay,
    propertyTaxPct, homeInsuranceAnnual, maintenancePct, hoaMonthly, pmiPct, costInflationPct,
    closingCostBuyPct, closingCostSellPct, discountPoints, extraPrincipalMonthly,
    rentersInsuranceMonthly,
    marginalTaxRatePct, standardDeductionAnnual, itemizeDeductions,
    annualIncome, monthlyOtherDebts, uiMode,
  };

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
    } catch (e) {
      // clipboard blocked — the visible box below still works
    }
  };

  // Hydration: an explicit shared link always wins; otherwise fall back to this browser's
  // last autosave.
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
    } catch (e) {
      // bad link or corrupted local save — start fresh
    }
    hydrated.current = true;
  }, []);

  // Debounced autosave — not the URL (see retirement-runway's App.jsx / CLAUDE.md for why).
  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(profileSnapshot));
      } catch (e) {
        // storage unavailable/full — silently skip
      }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [profileSnapshot]);

  const resetToDefaults = () => {
    if (!window.confirm("Clear all inputs and start fresh? This can't be undone.")) return;
    setHomePrice(DEFAULTS.homePrice); setDownPaymentPct(DEFAULTS.downPaymentPct);
    setMortgageRatePct(DEFAULTS.mortgageRatePct); setMortgageTermYears(DEFAULTS.mortgageTermYears);
    setHomeAppreciationPct(DEFAULTS.homeAppreciationPct); setMonthlyRent(DEFAULTS.monthlyRent);
    setRentGrowthPct(DEFAULTS.rentGrowthPct); setInvestmentReturnPct(DEFAULTS.investmentReturnPct);
    setYearsToStay(DEFAULTS.yearsToStay); setPropertyTaxPct(DEFAULTS.propertyTaxPct);
    setHomeInsuranceAnnual(DEFAULTS.homeInsuranceAnnual); setMaintenancePct(DEFAULTS.maintenancePct);
    setHoaMonthly(DEFAULTS.hoaMonthly); setPmiPct(DEFAULTS.pmiPct);
    setCostInflationPct(DEFAULTS.costInflationPct);
    setClosingCostBuyPct(DEFAULTS.closingCostBuyPct); setClosingCostSellPct(DEFAULTS.closingCostSellPct);
    setDiscountPoints(DEFAULTS.discountPoints); setExtraPrincipalMonthly(DEFAULTS.extraPrincipalMonthly);
    setRentersInsuranceMonthly(DEFAULTS.rentersInsuranceMonthly);
    setMarginalTaxRatePct(DEFAULTS.marginalTaxRatePct); setStandardDeductionAnnual(DEFAULTS.standardDeductionAnnual);
    setItemizeDeductions(DEFAULTS.itemizeDeductions);
    setAnnualIncome(DEFAULTS.annualIncome); setMonthlyOtherDebts(DEFAULTS.monthlyOtherDebts);
    setUiMode(DEFAULTS.uiMode);
  };

  const currentInputs = {
    homePrice, downPaymentPct, mortgageRatePct, mortgageTermYears, homeAppreciationPct,
    propertyTaxPct, homeInsuranceAnnual, maintenancePct, hoaMonthly, pmiPct, costInflationPct,
    closingCostBuyPct, closingCostSellPct, discountPoints, extraPrincipalMonthly,
    monthlyRent, rentGrowthPct, rentersInsuranceMonthly,
    investmentReturnPct, marginalTaxRatePct, standardDeductionAnnual, itemizeDeductions,
    yearsToStay,
  };

  const result = useMemo(() => simulateRentVsBuy(currentInputs), [
    homePrice, downPaymentPct, mortgageRatePct, mortgageTermYears, homeAppreciationPct,
    propertyTaxPct, homeInsuranceAnnual, maintenancePct, hoaMonthly, pmiPct, costInflationPct,
    closingCostBuyPct, closingCostSellPct, discountPoints, extraPrincipalMonthly,
    monthlyRent, rentGrowthPct, rentersInsuranceMonthly,
    investmentReturnPct, marginalTaxRatePct, standardDeductionAnnual, itemizeDeductions,
    yearsToStay,
  ]);

  // Recomputed on every relevant input change (see computeSliderDirections in model.js) so
  // each slider's gradient direction always reflects "which way helps buying, right now" —
  // not a fixed left-to-right convention.
  const sliderDirections = useMemo(
    () => computeSliderDirections(currentInputs, FIELD_RANGES, result.netWorthGap),
    [
      homePrice, downPaymentPct, mortgageRatePct, mortgageTermYears, homeAppreciationPct,
      propertyTaxPct, homeInsuranceAnnual, maintenancePct, hoaMonthly, pmiPct, costInflationPct,
      closingCostBuyPct, closingCostSellPct, discountPoints, extraPrincipalMonthly,
      monthlyRent, rentGrowthPct, rentersInsuranceMonthly,
      investmentReturnPct, marginalTaxRatePct, standardDeductionAnnual, itemizeDeductions,
      yearsToStay, result.netWorthGap,
    ]
  );

  const buyWins = result.netWorthGap >= 0;
  const gapAbs = Math.abs(result.netWorthGap);
  const winnerColor = buyWins ? BUY : RENT;
  const cashToClose = result.downPayment + result.buyingClosingCosts + result.pointsCost;

  const affordability = useMemo(
    () => computeAffordability(result.firstMonthHousingCostForDTI, monthlyOtherDebts, annualIncome),
    [result.firstMonthHousingCostForDTI, monthlyOtherDebts, annualIncome]
  );

  return (
    <div style={{ minHeight: "100vh", background: INK, color: PARCHMENT, fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        .rvb-serif { font-family: 'Fraunces', serif; }
        .rvb-mono { font-family: 'IBM Plex Mono', monospace; }
        input[type="number"], input[type="text"] {
          background: ${PANEL_2}; border: 1px solid ${GRID}; color: ${PARCHMENT};
          border-radius: 3px; padding: 7px 9px; font-family: 'IBM Plex Mono', monospace;
          font-size: 13px; width: 100%; box-sizing: border-box;
        }
        input:focus { outline: none; border-color: ${BUY}; }
        .rvb-toggle { border: 1px solid ${GRID}; background: transparent; color: ${MUTED}; padding: 8px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; cursor: pointer; }
        .rvb-toggle.active { background: ${BUY}; border-color: ${BUY}; color: ${INK}; font-weight: 600; }
        .rvb-field-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: ${MUTED}; }
        .rvb-section-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .1em; color: ${MUTED}; margin-bottom: 12px; }
        .rvb-collapsible-header {
          font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .1em; color: ${MUTED};
          margin-bottom: 12px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;
          background: transparent; border: none; width: 100%; padding: 0; text-align: left;
        }
        .rvb-collapsible-header:hover { color: ${BUY}; }
        .rvb-caret { font-size: 10px; transition: transform 0.15s ease; }
        .rvb-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${GRID}; align-items: center; }
        .rvb-row:last-child { border-bottom: none; }
        .rvb-slider-wrap { margin-bottom: 22px; }
        .rvb-slider-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px; }
        .rvb-slider-input-group { display: flex; align-items: center; gap: 4px; }
        .rvb-slider-number {
          width: 92px; text-align: right; background: ${PANEL_2}; border: 1px solid ${GRID}; color: ${PARCHMENT};
          border-radius: 3px; padding: 5px 7px; font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600;
        }
        .rvb-slider-number:focus { outline: none; border-color: ${BUY}; }
        .rvb-slider-adornment { font-size: 13px; color: ${MUTED}; font-weight: 600; }
        .rvb-slider-derived { font-size: 11px; color: ${MUTED}; margin-left: 4px; }
        .rvb-slider-track-wrap { position: relative; height: 20px; display: flex; align-items: center; }
        .rvb-slider-track { display: flex; gap: 2px; width: 100%; height: 10px; }
        .rvb-slider-segment { flex: 1; border-radius: 1px; }
        .rvb-slider-fill-marker { position: absolute; top: 50%; width: 4px; height: 22px; border-radius: 2px; background: ${PARCHMENT}; transform: translate(-50%, -50%); pointer-events: none; box-shadow: 0 1px 4px rgba(0,0,0,0.6); }
        .rvb-slider-input { position: absolute; top: -6px; left: 0; width: 100%; height: 32px; margin: 0; opacity: 0; cursor: pointer; }
        .rvb-slider-help { font-size: 11px; color: ${MUTED}; margin-top: 6px; line-height: 1.5; }
        @media (max-width: 780px) { .rvb-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      <div style={{ borderBottom: `1px solid ${GRID}`, padding: "28px 24px 24px", background: `linear-gradient(180deg, ${PANEL_2} 0%, ${INK} 100%)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
          <div className="rvb-mono" style={{ fontSize: "11px", letterSpacing: "0.14em", color: BUY }}>
            HOUSING MODEL — RENT VS. BUY · OPPORTUNITY-COST METHOD
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <div style={{ display: "flex" }}>
              <button className={`rvb-toggle ${uiMode === "basic" ? "active" : ""}`} style={{ borderRight: "none", fontSize: "11px", padding: "6px 10px" }} onClick={() => setUiMode("basic")}>Basic</button>
              <button className={`rvb-toggle ${uiMode === "advanced" ? "active" : ""}`} style={{ fontSize: "11px", padding: "6px 10px" }} onClick={() => setUiMode("advanced")}>Advanced</button>
            </div>
            <button className="rvb-toggle" style={{ fontSize: "11px", padding: "6px 10px" }} onClick={copyShareLink}>
              {linkCopied ? "✓ Link copied!" : "🔗 Copy shareable link"}
            </button>
            <button className="rvb-toggle" style={{ fontSize: "11px", padding: "6px 10px", color: "#D9604A", borderColor: "#D9604A" }} onClick={resetToDefaults}>Start fresh</button>
          </div>
        </div>

        {shareUrlDisplay && (
          <div style={{ border: `1px solid ${BUY}`, borderRadius: "4px", padding: "10px", marginBottom: "14px", background: PANEL_2, display: "flex", gap: "8px", alignItems: "center" }}>
            <input readOnly value={shareUrlDisplay} onFocus={(e) => e.target.select()} className="rvb-mono" style={{ flex: 1, fontSize: "11px" }} />
            <button className="rvb-toggle" style={{ fontSize: "11px", padding: "6px 10px", flexShrink: 0 }} onClick={() => setShareUrlDisplay(null)}>Close</button>
          </div>
        )}

        <h1 className="rvb-serif" style={{ fontSize: "30px", fontWeight: 600, margin: "0 0 6px 0" }}>
          Rent vs. Buy
        </h1>
        <p style={{ color: MUTED, fontSize: "14px", margin: 0, maxWidth: "600px" }}>
          Both paths start from the same cash. Buying ties it up as home equity; renting invests it —
          this compares where each path leaves you after {yearsToStay} year{Number(yearsToStay) === 1 ? "" : "s"}.
        </p>
        <p className="rvb-mono" style={{ color: MUTED, fontSize: "11px", margin: "10px 0 0 0", maxWidth: "600px", lineHeight: 1.6 }}>
          Autosaves in this browser as you go. Tap "Copy shareable link" to bookmark or send a specific scenario.
        </p>

        <div style={{ marginTop: "22px", display: "flex", gap: "40px", flexWrap: "wrap" }}>
          <div>
            <div className="rvb-field-label">After {yearsToStay} years</div>
            <div className="rvb-serif" style={{ fontSize: "34px", fontWeight: 700, color: winnerColor, lineHeight: 1.2 }}>
              {buyWins ? "Buying" : "Renting"} wins by {fmtMoney(gapAbs)}
            </div>
            <div style={{ fontSize: "12px", color: MUTED, marginTop: "4px" }}>
              {result.breakevenYear !== null
                ? `The two paths cross around year ${result.breakevenYear} — before that, ${buyWins ? "renting" : "buying"} was ahead.`
                : `${buyWins ? "Buying" : "Renting"} stays ahead the whole time on these numbers.`}
            </div>
          </div>
          <div>
            <div className="rvb-field-label">Cash needed to close</div>
            <div className="rvb-serif" style={{ fontSize: "34px", fontWeight: 700, color: PARCHMENT, lineHeight: 1.2 }}>
              {fmtMoney(cashToClose)}
            </div>
            <div style={{ fontSize: "12px", color: MUTED, marginTop: "4px" }}>
              Down payment + closing costs{discountPoints > 0 ? " + points" : ""} — the money you'd actually need on day one.
            </div>
          </div>
        </div>
      </div>

      <div className="rvb-grid" style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 0 }}>
        <div style={{ padding: "24px", borderRight: `1px solid ${GRID}`, background: PANEL }}>
          <div className="rvb-section-label">THE BASICS</div>
          <div style={{ fontSize: "11px", color: MUTED, marginBottom: "16px", lineHeight: 1.6 }}>
            Each slider's color shows which direction currently helps <span style={{ color: BUY }}>buying</span> vs.{" "}
            <span style={{ color: RENT }}>renting</span>, given where every other slider sits right now — nudge one
            and the others' colors can flip, since e.g. a bigger down payment only favors buying when it's not also
            crowding out a better return renting could get from investing that cash instead.
          </div>
          <GradientSlider label="Home price" value={homePrice} min={FIELD_RANGES.homePrice.min} max={FIELD_RANGES.homePrice.max} step={5000} onChange={setHomePrice} prefix="$" reversed={sliderDirections.homePrice === "rent"} />
          <GradientSlider label="Down payment" value={downPaymentPct} min={FIELD_RANGES.downPaymentPct.min} max={FIELD_RANGES.downPaymentPct.max} step={1} onChange={setDownPaymentPct} suffix="%" derived={(v) => fmtMoney(homePrice * (v / 100), true)} reversed={sliderDirections.downPaymentPct === "rent"} />
          <GradientSlider label="Mortgage rate" value={mortgageRatePct} min={FIELD_RANGES.mortgageRatePct.min} max={FIELD_RANGES.mortgageRatePct.max} step={0.125} onChange={setMortgageRatePct} suffix="%" reversed={sliderDirections.mortgageRatePct === "rent"} />
          <GradientSlider label="Mortgage term" value={mortgageTermYears} min={FIELD_RANGES.mortgageTermYears.min} max={FIELD_RANGES.mortgageTermYears.max} step={1} onChange={setMortgageTermYears} suffix="yr" reversed={sliderDirections.mortgageTermYears === "rent"} />
          <GradientSlider label="Monthly rent (equivalent home)" value={monthlyRent} min={FIELD_RANGES.monthlyRent.min} max={FIELD_RANGES.monthlyRent.max} step={50} onChange={setMonthlyRent} prefix="$" reversed={sliderDirections.monthlyRent === "rent"} />
          <GradientSlider label="Years you'll stay" value={yearsToStay} min={FIELD_RANGES.yearsToStay.min} max={FIELD_RANGES.yearsToStay.max} step={1} onChange={setYearsToStay} suffix="yr" reversed={sliderDirections.yearsToStay === "rent"} />
          <GradientSlider label="Investment return, if renting" value={investmentReturnPct} min={FIELD_RANGES.investmentReturnPct.min} max={FIELD_RANGES.investmentReturnPct.max} step={0.25} onChange={setInvestmentReturnPct} suffix="%" reversed={sliderDirections.investmentReturnPct === "rent"}
            helpText="What the money not spent on a down payment (and any month renting is cheaper) could earn invested instead." />
          <GradientSlider label="Home price appreciation" value={homeAppreciationPct} min={FIELD_RANGES.homeAppreciationPct.min} max={FIELD_RANGES.homeAppreciationPct.max} step={0.25} onChange={setHomeAppreciationPct} suffix="%" reversed={sliderDirections.homeAppreciationPct === "rent"} />

          <div style={{ fontSize: "11px", color: MUTED, marginTop: "8px", marginBottom: "18px", lineHeight: 1.6 }}>
            Estimated mortgage payment: <strong style={{ color: PARCHMENT }}>{fmtMoney(result.monthlyPayment)}/mo</strong> (principal + interest only, {mortgageTermYears}-yr term
            {discountPoints > 0 ? `, ${fmtPct(result.effectiveMortgageRatePct)} after points` : ""})
          </div>

          {uiMode === "advanced" && (
            <>
              <button className="rvb-collapsible-header" onClick={() => toggle("ownership")} style={{ marginTop: "10px" }}>
                <span>OWNERSHIP COSTS</span>
                <span className="rvb-caret" style={{ transform: expanded.ownership ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
              </button>
              {expanded.ownership && (
                <>
                  <GradientSlider label="Property tax" value={propertyTaxPct} min={FIELD_RANGES.propertyTaxPct.min} max={FIELD_RANGES.propertyTaxPct.max} step={0.05} onChange={setPropertyTaxPct} suffix="%/yr" reversed={sliderDirections.propertyTaxPct === "rent"} />
                  <div style={{ marginBottom: "14px" }}>
                    <span className="rvb-field-label">Homeowners insurance ($/yr)</span>
                    <input type="number" value={homeInsuranceAnnual} onChange={(e) => setHomeInsuranceAnnual(e.target.value)} />
                  </div>
                  <GradientSlider label="Maintenance" value={maintenancePct} min={FIELD_RANGES.maintenancePct.min} max={FIELD_RANGES.maintenancePct.max} step={0.05} onChange={setMaintenancePct} suffix="%/yr" reversed={sliderDirections.maintenancePct === "rent"} />
                  <div style={{ marginBottom: "14px" }}>
                    <span className="rvb-field-label">HOA dues ($/mo)</span>
                    <input type="number" value={hoaMonthly} onChange={(e) => setHoaMonthly(e.target.value)} />
                  </div>
                  <GradientSlider label="PMI (while equity < 20%)" value={pmiPct} min={FIELD_RANGES.pmiPct.min} max={FIELD_RANGES.pmiPct.max} step={0.05} onChange={setPmiPct} suffix="%/yr" reversed={sliderDirections.pmiPct === "rent"} />
                  <GradientSlider label="Insurance & HOA cost growth" value={costInflationPct} min={FIELD_RANGES.costInflationPct.min} max={FIELD_RANGES.costInflationPct.max} step={0.25} onChange={setCostInflationPct} suffix="%/yr" reversed={sliderDirections.costInflationPct === "rent"}
                    helpText="Property tax and maintenance already scale with home value; this grows insurance and HOA dues too, since those go up over time as well." />
                </>
              )}

              <button className="rvb-collapsible-header" onClick={() => toggle("transaction")} style={{ marginTop: "20px" }}>
                <span>BUYING &amp; SELLING COSTS</span>
                <span className="rvb-caret" style={{ transform: expanded.transaction ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
              </button>
              {expanded.transaction && (
                <>
                  <GradientSlider label="Closing costs, buying" value={closingCostBuyPct} min={FIELD_RANGES.closingCostBuyPct.min} max={FIELD_RANGES.closingCostBuyPct.max} step={0.25} onChange={setClosingCostBuyPct} suffix="%" derived={(v) => fmtMoney(homePrice * (v / 100), true)} reversed={sliderDirections.closingCostBuyPct === "rent"} />
                  <GradientSlider label="Selling costs (agent fees, etc.)" value={closingCostSellPct} min={FIELD_RANGES.closingCostSellPct.min} max={FIELD_RANGES.closingCostSellPct.max} step={0.25} onChange={setClosingCostSellPct} suffix="%" reversed={sliderDirections.closingCostSellPct === "rent"}
                    helpText="Charged against the home's future sale price when computing net worth at the end of the horizon." />
                </>
              )}

              <button className="rvb-collapsible-header" onClick={() => toggle("rental")} style={{ marginTop: "20px" }}>
                <span>RENTAL DETAILS</span>
                <span className="rvb-caret" style={{ transform: expanded.rental ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
              </button>
              {expanded.rental && (
                <>
                  <GradientSlider label="Rent growth" value={rentGrowthPct} min={FIELD_RANGES.rentGrowthPct.min} max={FIELD_RANGES.rentGrowthPct.max} step={0.25} onChange={setRentGrowthPct} suffix="%/yr" reversed={sliderDirections.rentGrowthPct === "rent"} />
                  <div style={{ marginBottom: "14px" }}>
                    <span className="rvb-field-label">Renters insurance ($/mo)</span>
                    <input type="number" value={rentersInsuranceMonthly} onChange={(e) => setRentersInsuranceMonthly(e.target.value)} />
                  </div>
                </>
              )}

              <button className="rvb-collapsible-header" onClick={() => toggle("tax")} style={{ marginTop: "20px" }}>
                <span>TAX TREATMENT</span>
                <span className="rvb-caret" style={{ transform: expanded.tax ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
              </button>
              {expanded.tax && (
                <>
                  <button className={`rvb-toggle ${itemizeDeductions ? "active" : ""}`} style={{ width: "100%", marginBottom: "12px" }} onClick={() => setItemizeDeductions(!itemizeDeductions)}>
                    {itemizeDeductions ? "Itemizing deductions ✓" : "Taking standard deduction — tap to itemize"}
                  </button>
                  {itemizeDeductions && (
                    <>
                      <GradientSlider label="Marginal tax rate" value={marginalTaxRatePct} min={FIELD_RANGES.marginalTaxRatePct.min} max={FIELD_RANGES.marginalTaxRatePct.max} step={1} onChange={setMarginalTaxRatePct} suffix="%" reversed={sliderDirections.marginalTaxRatePct === "rent"} />
                      <div style={{ marginBottom: "14px" }}>
                        <span className="rvb-field-label">Standard deduction, for comparison ($/yr)</span>
                        <input type="number" value={standardDeductionAnnual} onChange={(e) => setStandardDeductionAnnual(e.target.value)} />
                      </div>
                      <div style={{ fontSize: "11px", color: MUTED, lineHeight: 1.6 }}>
                        Only the amount your mortgage interest and property tax (capped at $10,000/yr, the
                        federal SALT cap) exceed the standard deduction actually lowers your tax bill —
                        that excess, times your marginal rate, is credited monthly against owning's cost.
                      </div>
                    </>
                  )}
                </>
              )}

              <button className="rvb-collapsible-header" onClick={() => toggle("extraPayments")} style={{ marginTop: "20px" }}>
                <span>EXTRA PAYMENTS &amp; POINTS</span>
                <span className="rvb-caret" style={{ transform: expanded.extraPayments ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
              </button>
              {expanded.extraPayments && (
                <>
                  <div style={{ fontSize: "11px", color: MUTED, marginBottom: "14px", lineHeight: 1.6 }}>
                    Two optional strategies, off by default. Both are real cash out of your pocket at the time —
                    that money isn't available to invest either, so both flow through the same cost comparison
                    as everything else above.
                  </div>
                  <div style={{ marginBottom: "14px" }}>
                    <span className="rvb-field-label">Extra principal payment ($/mo)</span>
                    <input type="number" value={extraPrincipalMonthly} onChange={(e) => setExtraPrincipalMonthly(e.target.value)} />
                  </div>
                  {extraPrincipalMonthly > 0 && result.payoffYears !== null && (
                    <div style={{ fontSize: "11px", color: MUTED, marginBottom: "14px" }}>
                      Pays off the loan in ~{result.payoffYears.toFixed(1)} years instead of {mortgageTermYears}.
                    </div>
                  )}
                  <GradientSlider label="Discount points" value={discountPoints} min={FIELD_RANGES.discountPoints.min} max={FIELD_RANGES.discountPoints.max} step={0.125} onChange={setDiscountPoints} suffix="pts" derived={(v) => fmtMoney(homePrice * (1 - downPaymentPct / 100) * (v / 100), true)} reversed={sliderDirections.discountPoints === "rent"}
                    helpText="Paid upfront at closing (1 point = 1% of your loan amount) to buy down the rate — assumes 0.25% off the rate per point, a common rule of thumb." />
                  {discountPoints > 0 && (
                    <div style={{ fontSize: "11px", color: MUTED, marginBottom: "14px" }}>
                      {fmtMoney(result.pointsCost)} upfront gets you {fmtPct(mortgageRatePct)} → {fmtPct(result.effectiveMortgageRatePct)}.
                    </div>
                  )}
                </>
              )}

              <button className="rvb-collapsible-header" onClick={() => toggle("affordability")} style={{ marginTop: "20px" }}>
                <span>CAN YOU AFFORD THIS?</span>
                <span className="rvb-caret" style={{ transform: expanded.affordability ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
              </button>
              {expanded.affordability && (
                <>
                  <div style={{ fontSize: "11px", color: MUTED, marginBottom: "14px", lineHeight: 1.6 }}>
                    A general guideline lenders use, not a lending decision: housing costs at or under 28% of gross
                    income, and total debt (housing plus everything else) at or under 36%. Real approvals vary.
                  </div>
                  <div style={{ marginBottom: "14px" }}>
                    <span className="rvb-field-label">Gross annual household income ($)</span>
                    <input type="number" value={annualIncome} onChange={(e) => setAnnualIncome(e.target.value)} />
                  </div>
                  <div style={{ marginBottom: "14px" }}>
                    <span className="rvb-field-label">Other monthly debt payments ($)</span>
                    <input type="number" value={monthlyOtherDebts} onChange={(e) => setMonthlyOtherDebts(e.target.value)} />
                  </div>
                  {affordability.frontEndOk === null ? (
                    <div style={{ fontSize: "12px", color: MUTED }}>Enter your income to see your ratios.</div>
                  ) : (
                    <div style={{ border: `1px solid ${GRID}`, borderRadius: "4px", overflow: "hidden" }}>
                      <div className="rvb-row" style={{ padding: "10px 12px" }}>
                        <span style={{ fontSize: "12px" }}>Housing / income (front-end)</span>
                        <span className="rvb-mono" style={{ fontSize: "13px", fontWeight: 600, color: affordability.frontEndOk ? OK : WARN }}>
                          {fmtPct(affordability.frontEndDTI)} {affordability.frontEndOk ? "✓" : "⚠"}
                        </span>
                      </div>
                      <div className="rvb-row" style={{ padding: "10px 12px" }}>
                        <span style={{ fontSize: "12px" }}>All debt / income (back-end)</span>
                        <span className="rvb-mono" style={{ fontSize: "13px", fontWeight: 600, color: affordability.backEndOk ? OK : WARN }}>
                          {fmtPct(affordability.backEndDTI)} {affordability.backEndOk ? "✓" : "⚠"}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div style={{ padding: "24px" }}>
          <div className="rvb-section-label">NET WORTH — YEAR 0 TO {yearsToStay}</div>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={result.rows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="year" stroke={MUTED} tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: MUTED }} tickLine={false} />
                <YAxis stroke={MUTED} tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: MUTED }} tickFormatter={(v) => fmtMoney(v, true)} tickLine={false} width={56} />
                <Tooltip contentStyle={{ background: PANEL_2, border: `1px solid ${GRID}`, borderRadius: "4px", fontFamily: "IBM Plex Mono", fontSize: "12px" }} labelFormatter={(y) => `Year ${y}`} formatter={(v, name) => [fmtMoney(v), name === "buyerNetWorth" ? "Buying" : "Renting"]} />
                {result.breakevenYear !== null && (
                  <ReferenceLine x={result.breakevenYear} stroke={PARCHMENT} strokeDasharray="3 3" label={{ value: "Crossover", position: "insideTopLeft", fill: MUTED, fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                )}
                <Line type="monotone" dataKey="buyerNetWorth" stroke={BUY} strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="renterNetWorth" stroke={RENT} strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", gap: "18px", fontSize: "12px", color: MUTED, marginTop: "4px" }} className="rvb-mono">
            <span><span style={{ color: BUY }}>■</span> Buying (home equity + side investments)</span>
            <span><span style={{ color: RENT }}>■</span> Renting (investment portfolio)</span>
          </div>

          <div style={{ marginTop: "30px" }}>
            <div className="rvb-section-label">MONTH ONE, SIDE BY SIDE</div>
            <div style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
              <div style={{ flex: 1, border: `1px solid ${BUY}`, borderRadius: "4px", padding: "14px" }}>
                <div className="rvb-field-label">Owning (after any tax benefit)</div>
                <div className="rvb-serif" style={{ fontSize: "24px", fontWeight: 700, color: BUY }}>{fmtMoney(result.firstMonthOwnCost)}/mo</div>
                <div style={{ fontSize: "11px", color: MUTED, marginTop: "6px" }}>
                  {fmtMoney(result.monthlyPayment)} mortgage + taxes, insurance, maintenance{itemizeDeductions ? ", less tax benefit" : ""}
                </div>
              </div>
              <div style={{ flex: 1, border: `1px solid ${RENT}`, borderRadius: "4px", padding: "14px" }}>
                <div className="rvb-field-label">Renting</div>
                <div className="rvb-serif" style={{ fontSize: "24px", fontWeight: 700, color: RENT }}>{fmtMoney(result.firstMonthRentCost)}/mo</div>
                <div style={{ fontSize: "11px", color: MUTED, marginTop: "6px" }}>
                  Rent + renters insurance
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "10px" }}>
            <div className="rvb-section-label">AT YEAR {yearsToStay}</div>
            <div style={{ border: `1px solid ${GRID}`, borderRadius: "4px", overflow: "hidden" }}>
              <div className="rvb-row rvb-mono" style={{ background: PANEL_2, fontSize: "11px", color: MUTED, textTransform: "uppercase", padding: "10px 12px" }}>
                <span style={{ flex: 2 }}>If you bought</span><span style={{ flex: 2, textAlign: "right" }}>If you rented</span>
              </div>
              <div className="rvb-row" style={{ padding: "12px" }}>
                <span style={{ fontSize: "13px" }}>Home value → {fmtMoney(result.final.homeValue ?? 0)}, minus mortgage owed → {fmtMoney(result.final.mortgageBalance ?? 0)}, minus selling costs</span>
              </div>
              <div className="rvb-row rvb-mono" style={{ padding: "12px" }}>
                <span style={{ fontSize: "16px", fontWeight: 700, color: BUY }}>{fmtMoney(result.final.buyerNetWorth)}</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: RENT }}>{fmtMoney(result.final.renterNetWorth)}</span>
              </div>
            </div>
            <div style={{ fontSize: "11px", color: MUTED, marginTop: "8px", lineHeight: 1.6 }}>
              Renting's total assumes the cash needed to close ({fmtMoney(cashToClose)}) went into the market on
              day one, plus whichever side had lower monthly cash costs each month invested the difference — so
              the two numbers are comparable dollar-for-dollar, not just "home equity" vs. "rent paid."
            </div>
          </div>

          <div style={{ marginTop: "30px", marginBottom: "10px" }}>
            <button className="rvb-collapsible-header" onClick={() => toggle("amortization")}>
              <span>AMORTIZATION SCHEDULE</span>
              <span className="rvb-caret" style={{ transform: expanded.amortization ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
            </button>
            {expanded.amortization && (
              <>
                <div style={{ fontSize: "11px", color: MUTED, marginBottom: "12px", lineHeight: 1.6 }}>
                  Principal and interest paid each year, and what's left on the loan — through year {yearsToStay},
                  the length of the comparison above{result.payoffYears !== null && result.payoffYears < yearsToStay
                    ? `, though the loan itself is fully paid off around year ${result.payoffYears.toFixed(1)}` : ""}.
                </div>
                <div style={{ border: `1px solid ${GRID}`, borderRadius: "4px", overflow: "hidden", maxHeight: "360px", overflowY: "auto" }}>
                  <div className="rvb-row rvb-mono" style={{ background: PANEL_2, fontSize: "11px", color: MUTED, textTransform: "uppercase", padding: "10px 12px", position: "sticky", top: 0 }}>
                    <span style={{ flex: 1 }}>Year</span>
                    <span style={{ flex: 2, textAlign: "right" }}>Principal</span>
                    <span style={{ flex: 2, textAlign: "right" }}>Interest</span>
                    <span style={{ flex: 2, textAlign: "right" }}>Balance</span>
                    <span style={{ flex: 2, textAlign: "right" }}>Equity</span>
                  </div>
                  {result.rows.slice(1).map((r) => (
                    <div key={r.year} className="rvb-row rvb-mono" style={{ fontSize: "12px", padding: "8px 12px" }}>
                      <span style={{ flex: 1 }}>{r.year}</span>
                      <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(r.principalPaid)}</span>
                      <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(r.interestPaid)}</span>
                      <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(r.mortgageBalance)}</span>
                      <span style={{ flex: 2, textAlign: "right" }}>{fmtMoney(r.homeEquity)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: "30px", marginBottom: "10px" }}>
            <button className="rvb-collapsible-header" onClick={() => toggle("about")}>
              <span>HOW THIS IS CALCULATED</span>
              <span className="rvb-caret" style={{ transform: expanded.about ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
            </button>
            {expanded.about && (
              <div style={{ fontSize: "12px", color: MUTED, lineHeight: 1.7 }}>
                <p>
                  Both scenarios start from the same amount of cash — what a buyer would put toward
                  a down payment and closing costs. In the buying scenario, that cash becomes home
                  equity, which grows (or shrinks) with home price appreciation and mortgage paydown.
                  In the renting scenario, that same cash is invested in the market from day one.
                </p>
                <p>
                  Every month afterward, whichever option costs less in actual cash — the full mortgage
                  payment plus taxes, insurance, maintenance, HOA, and PMI on one side; rent and renters
                  insurance on the other — lets its cheaper party invest the difference too. That's the
                  "opportunity cost of capital": money not spent one way is assumed to be put to work,
                  not left idle.
                </p>
                <p>
                  At the end of the horizon, buying's total is home value minus whatever's still owed on
                  the mortgage minus estimated selling costs, plus any side investments built up along the
                  way. Renting's total is just the investment portfolio. Whichever number is bigger "wins,"
                  and the gap is the dollar difference between the two paths — not a judgment about renting
                  or owning as a way of life, just the numbers on these particular assumptions.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RentVsBuyCalculator;
