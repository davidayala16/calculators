import { useMemo, useState, useEffect, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import GradientSlider from './GradientSlider.jsx';
import { simulateRentVsBuy, monthlyMortgagePayment } from './model.js';

const INK = "#12141C";
const PANEL = "#1B1F2B";
const PANEL_2 = "#161923";
const GRID = "#2C3142";
const PARCHMENT = "#EAEAF2";
const MUTED = "#8B90A8";
const BUY = "#E2704A";
const RENT = "#4F8EF7";

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
  closingCostBuyPct: 3, closingCostSellPct: 6,
  rentersInsuranceMonthly: 15,
  marginalTaxRatePct: 24, standardDeductionAnnual: 29200, itemizeDeductions: false,
  uiMode: "basic",
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
  const [closingCostBuyPct, setClosingCostBuyPct] = useState(DEFAULTS.closingCostBuyPct);
  const [closingCostSellPct, setClosingCostSellPct] = useState(DEFAULTS.closingCostSellPct);
  const [rentersInsuranceMonthly, setRentersInsuranceMonthly] = useState(DEFAULTS.rentersInsuranceMonthly);
  const [marginalTaxRatePct, setMarginalTaxRatePct] = useState(DEFAULTS.marginalTaxRatePct);
  const [standardDeductionAnnual, setStandardDeductionAnnual] = useState(DEFAULTS.standardDeductionAnnual);
  const [itemizeDeductions, setItemizeDeductions] = useState(DEFAULTS.itemizeDeductions);

  const [uiMode, setUiMode] = useState(DEFAULTS.uiMode);
  const [expanded, setExpanded] = useState({ ownership: true, transaction: false, rental: false, tax: false, about: false });
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
    if (p.closingCostBuyPct !== undefined) setClosingCostBuyPct(p.closingCostBuyPct);
    if (p.closingCostSellPct !== undefined) setClosingCostSellPct(p.closingCostSellPct);
    if (p.rentersInsuranceMonthly !== undefined) setRentersInsuranceMonthly(p.rentersInsuranceMonthly);
    if (p.marginalTaxRatePct !== undefined) setMarginalTaxRatePct(p.marginalTaxRatePct);
    if (p.standardDeductionAnnual !== undefined) setStandardDeductionAnnual(p.standardDeductionAnnual);
    if (p.itemizeDeductions !== undefined) setItemizeDeductions(p.itemizeDeductions);
    if (p.uiMode !== undefined) setUiMode(p.uiMode);
  };

  const encodeProfile = (obj) => {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); } catch (e) { return null; }
  };
  const decodeProfile = (str) => JSON.parse(decodeURIComponent(escape(atob(str))));

  const profileSnapshot = {
    homePrice, downPaymentPct, mortgageRatePct, mortgageTermYears, homeAppreciationPct,
    monthlyRent, rentGrowthPct, investmentReturnPct, yearsToStay,
    propertyTaxPct, homeInsuranceAnnual, maintenancePct, hoaMonthly, pmiPct,
    closingCostBuyPct, closingCostSellPct, rentersInsuranceMonthly,
    marginalTaxRatePct, standardDeductionAnnual, itemizeDeductions, uiMode,
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
    setClosingCostBuyPct(DEFAULTS.closingCostBuyPct); setClosingCostSellPct(DEFAULTS.closingCostSellPct);
    setRentersInsuranceMonthly(DEFAULTS.rentersInsuranceMonthly);
    setMarginalTaxRatePct(DEFAULTS.marginalTaxRatePct); setStandardDeductionAnnual(DEFAULTS.standardDeductionAnnual);
    setItemizeDeductions(DEFAULTS.itemizeDeductions); setUiMode(DEFAULTS.uiMode);
  };

  const result = useMemo(() => simulateRentVsBuy({
    homePrice, downPaymentPct, mortgageRatePct, mortgageTermYears, homeAppreciationPct,
    propertyTaxPct, homeInsuranceAnnual, maintenancePct, hoaMonthly, pmiPct,
    closingCostBuyPct, closingCostSellPct,
    monthlyRent, rentGrowthPct, rentersInsuranceMonthly,
    investmentReturnPct, marginalTaxRatePct, standardDeductionAnnual, itemizeDeductions,
    yearsToStay,
  }), [
    homePrice, downPaymentPct, mortgageRatePct, mortgageTermYears, homeAppreciationPct,
    propertyTaxPct, homeInsuranceAnnual, maintenancePct, hoaMonthly, pmiPct,
    closingCostBuyPct, closingCostSellPct,
    monthlyRent, rentGrowthPct, rentersInsuranceMonthly,
    investmentReturnPct, marginalTaxRatePct, standardDeductionAnnual, itemizeDeductions,
    yearsToStay,
  ]);

  const buyWins = result.netWorthGap >= 0;
  const gapAbs = Math.abs(result.netWorthGap);
  const winnerColor = buyWins ? BUY : RENT;

  const previewPayment = useMemo(
    () => monthlyMortgagePayment(homePrice * (1 - downPaymentPct / 100), mortgageRatePct, mortgageTermYears),
    [homePrice, downPaymentPct, mortgageRatePct, mortgageTermYears]
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
        .rvb-slider-wrap { margin-bottom: 20px; }
        .rvb-slider-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .rvb-slider-value { font-size: 13px; color: ${PARCHMENT}; font-weight: 600; }
        .rvb-slider-track { position: relative; height: 8px; border-radius: 4px; background: linear-gradient(90deg, #2E6BE0 0%, #9B4FE0 50%, #E0473B 100%); }
        .rvb-slider-fill-marker { position: absolute; top: 50%; width: 16px; height: 16px; border-radius: 50%; background: ${PANEL_2}; border: 3px solid ${PARCHMENT}; transform: translate(-50%, -50%); pointer-events: none; box-shadow: 0 1px 4px rgba(0,0,0,0.5); }
        .rvb-slider-input { position: absolute; top: -8px; left: 0; width: 100%; height: 24px; margin: 0; opacity: 0; cursor: pointer; }
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

        <div style={{ marginTop: "22px" }}>
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
      </div>

      <div className="rvb-grid" style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 0 }}>
        <div style={{ padding: "24px", borderRight: `1px solid ${GRID}`, background: PANEL }}>
          <div className="rvb-section-label">THE BASICS</div>
          <GradientSlider label="Home price" value={homePrice} min={100000} max={2000000} step={5000} onChange={setHomePrice} formatValue={(v) => fmtMoney(v, true)} />
          <GradientSlider label="Down payment" value={downPaymentPct} min={0} max={100} step={1} onChange={setDownPaymentPct} formatValue={(v) => `${v}%  (${fmtMoney(homePrice * (v / 100), true)})`} />
          <GradientSlider label="Mortgage rate" value={mortgageRatePct} min={0} max={12} step={0.125} onChange={setMortgageRatePct} formatValue={fmtPct} />
          <GradientSlider label="Monthly rent (equivalent home)" value={monthlyRent} min={500} max={10000} step={50} onChange={setMonthlyRent} formatValue={(v) => fmtMoney(v)} />
          <GradientSlider label="Years you'll stay" value={yearsToStay} min={1} max={40} step={1} onChange={setYearsToStay} formatValue={(v) => `${v} yr`} />
          <GradientSlider label="Investment return, if renting" value={investmentReturnPct} min={0} max={15} step={0.25} onChange={setInvestmentReturnPct} formatValue={fmtPct}
            helpText="What the money not spent on a down payment (and any month renting is cheaper) could earn invested instead." />
          <GradientSlider label="Home price appreciation" value={homeAppreciationPct} min={-5} max={10} step={0.25} onChange={setHomeAppreciationPct} formatValue={fmtPct} />

          <div style={{ fontSize: "11px", color: MUTED, marginTop: "8px", marginBottom: "18px", lineHeight: 1.6 }}>
            Estimated mortgage payment: <strong style={{ color: PARCHMENT }}>{fmtMoney(previewPayment)}/mo</strong> (principal + interest only, {mortgageTermYears}-yr term)
          </div>

          {uiMode === "advanced" && (
            <>
              <button className="rvb-collapsible-header" onClick={() => toggle("ownership")} style={{ marginTop: "10px" }}>
                <span>OWNERSHIP COSTS</span>
                <span className="rvb-caret" style={{ transform: expanded.ownership ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
              </button>
              {expanded.ownership && (
                <>
                  <GradientSlider label="Property tax" value={propertyTaxPct} min={0} max={4} step={0.05} onChange={setPropertyTaxPct} formatValue={(v) => `${fmtPct(v)}/yr`} />
                  <div style={{ marginBottom: "14px" }}>
                    <span className="rvb-field-label">Homeowners insurance ($/yr)</span>
                    <input type="number" value={homeInsuranceAnnual} onChange={(e) => setHomeInsuranceAnnual(e.target.value)} />
                  </div>
                  <GradientSlider label="Maintenance" value={maintenancePct} min={0} max={4} step={0.05} onChange={setMaintenancePct} formatValue={(v) => `${fmtPct(v)}/yr`} />
                  <div style={{ marginBottom: "14px" }}>
                    <span className="rvb-field-label">HOA dues ($/mo)</span>
                    <input type="number" value={hoaMonthly} onChange={(e) => setHoaMonthly(e.target.value)} />
                  </div>
                  <GradientSlider label="PMI (while equity < 20%)" value={pmiPct} min={0} max={2} step={0.05} onChange={setPmiPct} formatValue={(v) => `${fmtPct(v)}/yr`} />
                </>
              )}

              <button className="rvb-collapsible-header" onClick={() => toggle("transaction")} style={{ marginTop: "20px" }}>
                <span>BUYING &amp; SELLING COSTS</span>
                <span className="rvb-caret" style={{ transform: expanded.transaction ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
              </button>
              {expanded.transaction && (
                <>
                  <GradientSlider label="Closing costs, buying" value={closingCostBuyPct} min={0} max={8} step={0.25} onChange={setClosingCostBuyPct} formatValue={(v) => `${fmtPct(v)} (${fmtMoney(homePrice * (v / 100), true)})`} />
                  <GradientSlider label="Selling costs (agent fees, etc.)" value={closingCostSellPct} min={0} max={10} step={0.25} onChange={setClosingCostSellPct} formatValue={fmtPct}
                    helpText="Charged against the home's future sale price when computing net worth at the end of the horizon." />
                </>
              )}

              <button className="rvb-collapsible-header" onClick={() => toggle("rental")} style={{ marginTop: "20px" }}>
                <span>RENTAL DETAILS</span>
                <span className="rvb-caret" style={{ transform: expanded.rental ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
              </button>
              {expanded.rental && (
                <>
                  <GradientSlider label="Rent growth" value={rentGrowthPct} min={0} max={10} step={0.25} onChange={setRentGrowthPct} formatValue={(v) => `${fmtPct(v)}/yr`} />
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
                      <GradientSlider label="Marginal tax rate" value={marginalTaxRatePct} min={0} max={50} step={1} onChange={setMarginalTaxRatePct} formatValue={fmtPct} />
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
              Renting's total assumes the down payment and buying closing costs
              ({fmtMoney(result.downPayment + result.buyingClosingCosts)}) went into the market on day one,
              plus whichever side had lower monthly cash costs each month invested the difference — so the two
              numbers are comparable dollar-for-dollar, not just "home equity" vs. "rent paid."
            </div>
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
