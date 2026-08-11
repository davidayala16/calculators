import { useMemo, useState, useEffect, useRef } from 'react';

const INK = "#16211A";
const PANEL = "#1F2E22";
const PANEL_2 = "#182417";
const GRID = "#33463A";
const PARCHMENT = "#F4F1E6";
const MUTED = "#9CB0A0";
const LIME = "#8FBF3F";
const CITRUS = "#F2B705";
const RUST = "#C77B5F";

// Versioned so a future change to the state shape can't collide with an old saved blob.
const AUTOSAVE_KEY = "carb-gel-calculator:autosave-v1";

// Sane ceiling for total run/event duration. Real ultra-endurance events can run well over
// a day, but an unbounded value here would let a transient or fat-fingered input (a typed
// extra digit in hours or minutes) blow up the dose-schedule loop below. 100 hours covers
// any single continuous effort with huge headroom.
const MAX_HOURS = 100;

// Ceiling for the feed-schedule loop. Duration is already clamped to MAX_HOURS and the dose
// interval is floored at 1 minute below, so the dose count is bounded on both sides — this is
// a second, independent backstop in case those two combine at their extremes (6000 minutes /
// 1 minute = 6000 rows), keeping the rendered list small regardless.
const MAX_DOSES = 200;

// Approximate — powder/liquid density varies by brand and how you measure. These are only
// used for the informational gram readout next to each spoon measurement.
const GRAMS_PER_TBSP = { maltodextrin: 8, sugar: 12.5, water: 14.8 };
const GRAMS_PER_TSP = { pectin: 2.5, sodiumCitrate: 4.5, lemonJuice: 5, vanilla: 4.2 };

const FRACTION_GLYPHS = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];

function clamp(n, lo, hi) {
  if (!isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}
function toNum(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function nonNeg(v) {
  return Math.max(toNum(v), 0);
}

function fmtQty(value, unit) {
  if (!isFinite(value) || value <= 0) return `0 ${unit}`;
  let whole = Math.floor(value);
  let eighths = Math.round((value - whole) * 8);
  if (eighths === 8) { whole += 1; eighths = 0; }
  const glyph = FRACTION_GLYPHS[eighths];
  if (whole === 0 && glyph) return `${glyph} ${unit}`;
  if (glyph) return `${whole} ${glyph} ${unit}`;
  return `${whole} ${unit}`;
}
function fmtG(value) {
  if (!isFinite(value) || value <= 0) return "0g";
  return value < 10 ? `${value.toFixed(1)}g` : `${Math.round(value)}g`;
}
function fmtMg(value) {
  if (!isFinite(value)) return "0 mg";
  return `${Math.round(value).toLocaleString()} mg`;
}
function fmtHM(totalMinutes) {
  const m = Math.max(Math.round(totalMinutes), 0);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}m`;
  return `${h}h ${mm}m`;
}

const GUT_TRAINING_CEILING = { untrained: 60, trained: 90, veteran: 120 };
const INTENSITY_FACTOR = { easy: 0.2, moderate: 0.55, hard: 1 };

// Duration-based carb-intake guidance is standard sports-nutrition practice (roughly: not much
// needed under an hour, 30-60g/hr for 1-2.5hr efforts, 60-90+g/hr beyond that for a trained gut).
// Gut training raises the practical ceiling; intensity nudges where in the range to land.
function recommendedCarbRate(durationHours, gutTraining, intensity) {
  let lo, hi;
  if (durationHours < 1) { lo = 0; hi = 30; }
  else if (durationHours < 1.5) { lo = 30; hi = 60; }
  else if (durationHours < 2.5) { lo = 45; hi = 75; }
  else { lo = 60; hi = 90; }
  const ceilingByTraining = GUT_TRAINING_CEILING[gutTraining] ?? 90;
  hi = Math.min(hi, ceilingByTraining);
  lo = Math.min(lo, hi);
  const factor = INTENSITY_FACTOR[intensity] ?? 0.55;
  return { lo, hi, recommended: Math.round(lo + (hi - lo) * factor) };
}

function computeDurationHours(hrs, mins) {
  const total = nonNeg(hrs) + nonNeg(mins) / 60;
  return clamp(total, 0, MAX_HOURS);
}

// Core plan math. Pure function of raw (string) inputs so it's easy to reason about and test —
// every field is floored/clamped here rather than trusting the caller, so a bad value in any
// single input can't propagate into a division-by-zero or an unbounded loop below.
function computeGelPlan(inputs) {
  const durationHours = computeDurationHours(inputs.durationHrs, inputs.durationMins);
  const durationMinutes = durationHours * 60;

  const distance = nonNeg(inputs.distance);
  const paceMinPerUnit = distance > 0 ? durationMinutes / distance : null;

  const rateGuide = recommendedCarbRate(durationHours, inputs.gutTraining, inputs.intensity);
  const targetRate = inputs.targetRateMode === "custom" ? nonNeg(inputs.customTargetRate) : rateGuide.recommended;
  const totalCarbsNeeded = durationHours * targetRate;

  const drinkServings = nonNeg(inputs.drinkServings);
  const carbsPerServing = nonNeg(inputs.carbsPerServing);
  const sodiumPerServing = nonNeg(inputs.sodiumPerServing);
  const carbsFromDrink = drinkServings * carbsPerServing;
  const sodiumFromDrink = drinkServings * sodiumPerServing;

  const carbsNeededFromGel = Math.max(totalCarbsNeeded - carbsFromDrink, 0);

  const sweatRate = nonNeg(inputs.sweatRate);
  const sweatSodiumConc = nonNeg(inputs.sweatSodiumConc);
  const sodiumReplacementPct = clamp(toNum(inputs.sodiumReplacementPct), 0, 200);
  const totalSodiumLoss = sweatRate * durationHours * sweatSodiumConc;
  const targetSodiumReplacement = totalSodiumLoss * (sodiumReplacementPct / 100);
  const sodiumNeededFromGel = Math.max(targetSodiumReplacement - sodiumFromDrink, 0);

  // Floored at 1 so a base recipe carb yield of 0 (or blank) can't divide by zero.
  const baseCarbsG = Math.max(nonNeg(inputs.baseCarbsG), 1);
  const baseSodiumCitrateTsp = nonNeg(inputs.baseSodiumCitrateTsp);
  const sodiumMgPerTspCitrate = nonNeg(inputs.sodiumMgPerTspCitrate);
  const baseSodiumMg = baseSodiumCitrateTsp * sodiumMgPerTspCitrate;

  // Two independent scale factors, not one: the carb-bearing ingredients scale to the carbs
  // still needed after the sports drink, and the sodium citrate scales separately to the sodium
  // still needed after the drink — mirroring the actual advice ("you're getting sodium from
  // Gatorade, so you don't need a lot of salt in the gel") instead of just batching the recipe.
  const carbMultiplier = carbsNeededFromGel / baseCarbsG;
  const sodiumMultiplier = baseSodiumMg > 0 ? sodiumNeededFromGel / baseSodiumMg : 0;

  const maltodextrinTbsp = nonNeg(inputs.baseMaltodextrinTbsp) * carbMultiplier;
  const sugarTbsp = nonNeg(inputs.baseSugarTbsp) * carbMultiplier;
  const pectinTsp = nonNeg(inputs.basePectinTsp) * carbMultiplier;
  const lemonJuiceTsp = nonNeg(inputs.baseLemonJuiceTsp) * carbMultiplier;
  const waterTbsp = nonNeg(inputs.baseWaterTbsp) * carbMultiplier;
  const vanillaTsp = inputs.includeVanilla ? nonNeg(inputs.baseVanillaTsp) * carbMultiplier : 0;
  const sodiumCitrateTsp = baseSodiumCitrateTsp * sodiumMultiplier;

  const totalMassG =
    maltodextrinTbsp * GRAMS_PER_TBSP.maltodextrin +
    sugarTbsp * GRAMS_PER_TBSP.sugar +
    waterTbsp * GRAMS_PER_TBSP.water +
    pectinTsp * GRAMS_PER_TSP.pectin +
    sodiumCitrateTsp * GRAMS_PER_TSP.sodiumCitrate +
    lemonJuiceTsp * GRAMS_PER_TSP.lemonJuice +
    vanillaTsp * GRAMS_PER_TSP.vanilla;

  const servingSizeG = Math.max(nonNeg(inputs.servingSizeG), 1);
  const numServings = totalMassG / servingSizeG;

  // Dose interval floored at 1 minute and capped at a day — both ends of the division below are
  // therefore always finite and non-zero regardless of what was typed.
  const doseIntervalMin = clamp(nonNeg(inputs.doseIntervalMin) || 1, 1, 1440);
  const numDoses = clamp(Math.ceil(durationMinutes / doseIntervalMin), 0, MAX_DOSES);
  const carbsPerDose = numDoses > 0 ? carbsNeededFromGel / numDoses : 0;
  const maxCarbsPerDose = Math.max(nonNeg(inputs.maxCarbsPerDose), 1);

  return {
    durationHours, durationMinutes, paceMinPerUnit, rateGuide, targetRate, totalCarbsNeeded,
    carbsFromDrink, sodiumFromDrink, carbsNeededFromGel, totalSodiumLoss, targetSodiumReplacement,
    sodiumNeededFromGel, carbMultiplier, sodiumMultiplier,
    maltodextrinTbsp, sugarTbsp, pectinTsp, lemonJuiceTsp, waterTbsp, vanillaTsp, sodiumCitrateTsp,
    totalMassG, numServings, doseIntervalMin, numDoses, carbsPerDose, maxCarbsPerDose,
  };
}

const DEFAULTS = {
  distance: "13.1", distanceUnit: "mi",
  durationHrs: "1", durationMins: "45",
  gutTraining: "trained", intensity: "moderate",
  targetRateMode: "auto", customTargetRate: "60",
  drinkServings: "2", carbsPerServing: "21", sodiumPerServing: "160",
  sweatRate: "1.0", sweatSodiumConc: "700", sodiumReplacementPct: "70",
  baseMaltodextrinTbsp: "8", baseSugarTbsp: "1", basePectinTsp: "0.25",
  baseSodiumCitrateTsp: "0.25", baseLemonJuiceTsp: "2", baseWaterTbsp: "5.5",
  includeVanilla: true, baseVanillaTsp: "0.125", baseCarbsG: "80",
  sodiumMgPerTspCitrate: "1040",
  doseIntervalMin: "20", maxCarbsPerDose: "30", servingSizeG: "35",
};

function CarbGelCalculator() {
  const [distance, setDistance] = useState(DEFAULTS.distance);
  const [distanceUnit, setDistanceUnit] = useState(DEFAULTS.distanceUnit);
  const [durationHrs, setDurationHrs] = useState(DEFAULTS.durationHrs);
  const [durationMins, setDurationMins] = useState(DEFAULTS.durationMins);

  const [gutTraining, setGutTraining] = useState(DEFAULTS.gutTraining);
  const [intensity, setIntensity] = useState(DEFAULTS.intensity);
  const [targetRateMode, setTargetRateMode] = useState(DEFAULTS.targetRateMode);
  const [customTargetRate, setCustomTargetRate] = useState(DEFAULTS.customTargetRate);

  const [drinkServings, setDrinkServings] = useState(DEFAULTS.drinkServings);
  const [carbsPerServing, setCarbsPerServing] = useState(DEFAULTS.carbsPerServing);
  const [sodiumPerServing, setSodiumPerServing] = useState(DEFAULTS.sodiumPerServing);

  const [sweatRate, setSweatRate] = useState(DEFAULTS.sweatRate);
  const [sweatSodiumConc, setSweatSodiumConc] = useState(DEFAULTS.sweatSodiumConc);
  const [sodiumReplacementPct, setSodiumReplacementPct] = useState(DEFAULTS.sodiumReplacementPct);

  const [baseMaltodextrinTbsp, setBaseMaltodextrinTbsp] = useState(DEFAULTS.baseMaltodextrinTbsp);
  const [baseSugarTbsp, setBaseSugarTbsp] = useState(DEFAULTS.baseSugarTbsp);
  const [basePectinTsp, setBasePectinTsp] = useState(DEFAULTS.basePectinTsp);
  const [baseSodiumCitrateTsp, setBaseSodiumCitrateTsp] = useState(DEFAULTS.baseSodiumCitrateTsp);
  const [baseLemonJuiceTsp, setBaseLemonJuiceTsp] = useState(DEFAULTS.baseLemonJuiceTsp);
  const [baseWaterTbsp, setBaseWaterTbsp] = useState(DEFAULTS.baseWaterTbsp);
  const [includeVanilla, setIncludeVanilla] = useState(DEFAULTS.includeVanilla);
  const [baseVanillaTsp, setBaseVanillaTsp] = useState(DEFAULTS.baseVanillaTsp);
  const [baseCarbsG, setBaseCarbsG] = useState(DEFAULTS.baseCarbsG);
  const [sodiumMgPerTspCitrate, setSodiumMgPerTspCitrate] = useState(DEFAULTS.sodiumMgPerTspCitrate);

  const [doseIntervalMin, setDoseIntervalMin] = useState(DEFAULTS.doseIntervalMin);
  const [maxCarbsPerDose, setMaxCarbsPerDose] = useState(DEFAULTS.maxCarbsPerDose);
  const [servingSizeG, setServingSizeG] = useState(DEFAULTS.servingSizeG);

  const [uiMode, setUiMode] = useState("basic");
  const [expanded, setExpanded] = useState({ sweatSodium: false, recipeBase: false, dosing: false });
  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Persistence: fully self-contained, no account or backend calls. Two layers — a debounced
  // localStorage autosave (this browser only, survives refresh/crash, needs no action) and an
  // explicit shareable link (works across devices, only updates on "Copy shareable link"). A
  // link in the URL always wins over the local save, so opening someone else's link (or an
  // older link of your own) never gets silently overridden by whatever's in local storage.
  const hydrated = useRef(false);
  const saveTimer = useRef(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareUrlDisplay, setShareUrlDisplay] = useState(null);

  const applyProfile = (p) => {
    if (p.distance !== undefined) setDistance(p.distance);
    if (p.distanceUnit !== undefined) setDistanceUnit(p.distanceUnit);
    if (p.durationHrs !== undefined) setDurationHrs(p.durationHrs);
    if (p.durationMins !== undefined) setDurationMins(p.durationMins);
    if (p.gutTraining !== undefined) setGutTraining(p.gutTraining);
    if (p.intensity !== undefined) setIntensity(p.intensity);
    if (p.targetRateMode !== undefined) setTargetRateMode(p.targetRateMode);
    if (p.customTargetRate !== undefined) setCustomTargetRate(p.customTargetRate);
    if (p.drinkServings !== undefined) setDrinkServings(p.drinkServings);
    if (p.carbsPerServing !== undefined) setCarbsPerServing(p.carbsPerServing);
    if (p.sodiumPerServing !== undefined) setSodiumPerServing(p.sodiumPerServing);
    if (p.sweatRate !== undefined) setSweatRate(p.sweatRate);
    if (p.sweatSodiumConc !== undefined) setSweatSodiumConc(p.sweatSodiumConc);
    if (p.sodiumReplacementPct !== undefined) setSodiumReplacementPct(p.sodiumReplacementPct);
    if (p.baseMaltodextrinTbsp !== undefined) setBaseMaltodextrinTbsp(p.baseMaltodextrinTbsp);
    if (p.baseSugarTbsp !== undefined) setBaseSugarTbsp(p.baseSugarTbsp);
    if (p.basePectinTsp !== undefined) setBasePectinTsp(p.basePectinTsp);
    if (p.baseSodiumCitrateTsp !== undefined) setBaseSodiumCitrateTsp(p.baseSodiumCitrateTsp);
    if (p.baseLemonJuiceTsp !== undefined) setBaseLemonJuiceTsp(p.baseLemonJuiceTsp);
    if (p.baseWaterTbsp !== undefined) setBaseWaterTbsp(p.baseWaterTbsp);
    if (p.includeVanilla !== undefined) setIncludeVanilla(p.includeVanilla);
    if (p.baseVanillaTsp !== undefined) setBaseVanillaTsp(p.baseVanillaTsp);
    if (p.baseCarbsG !== undefined) setBaseCarbsG(p.baseCarbsG);
    if (p.sodiumMgPerTspCitrate !== undefined) setSodiumMgPerTspCitrate(p.sodiumMgPerTspCitrate);
    if (p.doseIntervalMin !== undefined) setDoseIntervalMin(p.doseIntervalMin);
    if (p.maxCarbsPerDose !== undefined) setMaxCarbsPerDose(p.maxCarbsPerDose);
    if (p.servingSizeG !== undefined) setServingSizeG(p.servingSizeG);
    if (p.uiMode !== undefined) setUiMode(p.uiMode);
  };

  const profileSnapshot = {
    distance, distanceUnit, durationHrs, durationMins, gutTraining, intensity,
    targetRateMode, customTargetRate, drinkServings, carbsPerServing, sodiumPerServing,
    sweatRate, sweatSodiumConc, sodiumReplacementPct,
    baseMaltodextrinTbsp, baseSugarTbsp, basePectinTsp, baseSodiumCitrateTsp, baseLemonJuiceTsp,
    baseWaterTbsp, includeVanilla, baseVanillaTsp, baseCarbsG, sodiumMgPerTspCitrate,
    doseIntervalMin, maxCarbsPerDose, servingSizeG, uiMode,
  };

  const encodeProfile = (obj) => {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    } catch (_e) {
      return null;
    }
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
    setShareUrlDisplay(url); // always show it — don't depend on clipboard permissions working
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (_e) {
      // clipboard blocked (common in sandboxed previews) — the visible box below still works
    }
  };

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const d = params.get("d");
      if (d) {
        applyProfile(decodeProfile(d)); // a shareable link with state baked in — takes priority
      } else {
        const saved = localStorage.getItem(AUTOSAVE_KEY);
        if (saved) applyProfile(JSON.parse(saved)); // no link — fall back to this browser's last save
      }
    } catch (_e) {
      // bad link or corrupted local save — start fresh
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave to localStorage, debounced so rapid typing doesn't hit disk on every keystroke.
  // Deliberately not the URL — see CLAUDE.md: rewriting the address bar on every keystroke
  // conflicts with how the static build is hosted and can lose in-progress edits.
  useEffect(() => {
    if (!hydrated.current) return; // don't clobber a saved profile with defaults before hydration runs
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(profileSnapshot));
      } catch (_e) {
        // storage unavailable/full (e.g. private browsing) — silently skip
      }
    }, 400);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(profileSnapshot)]);

  const plan = useMemo(
    () => computeGelPlan({
      distance, durationHrs, durationMins, gutTraining, intensity, targetRateMode, customTargetRate,
      drinkServings, carbsPerServing, sodiumPerServing, sweatRate, sweatSodiumConc, sodiumReplacementPct,
      baseMaltodextrinTbsp, baseSugarTbsp, basePectinTsp, baseSodiumCitrateTsp, baseLemonJuiceTsp,
      baseWaterTbsp, includeVanilla, baseVanillaTsp, baseCarbsG, sodiumMgPerTspCitrate,
      doseIntervalMin, maxCarbsPerDose, servingSizeG,
    }),
    [distance, durationHrs, durationMins, gutTraining, intensity, targetRateMode, customTargetRate,
      drinkServings, carbsPerServing, sodiumPerServing, sweatRate, sweatSodiumConc, sodiumReplacementPct,
      baseMaltodextrinTbsp, baseSugarTbsp, basePectinTsp, baseSodiumCitrateTsp, baseLemonJuiceTsp,
      baseWaterTbsp, includeVanilla, baseVanillaTsp, baseCarbsG, sodiumMgPerTspCitrate,
      doseIntervalMin, maxCarbsPerDose, servingSizeG]
  );

  const doseSchedule = useMemo(() => {
    // numDoses is already clamped to [0, MAX_DOSES] inside computeGelPlan, so this array is
    // always small and bounded regardless of what was typed into duration or interval.
    return Array.from({ length: plan.numDoses }, (_, i) => ({
      n: i + 1,
      atMinute: Math.round(Math.min((i + 1) * plan.doseIntervalMin, plan.durationMinutes)),
      carbs: plan.carbsPerDose,
    }));
  }, [plan.numDoses, plan.doseIntervalMin, plan.durationMinutes, plan.carbsPerDose]);

  const resetToBlank = () => {
    if (!window.confirm("Clear all inputs and start fresh? This can't be undone.")) return;
    setDistance(DEFAULTS.distance); setDistanceUnit(DEFAULTS.distanceUnit);
    setDurationHrs(DEFAULTS.durationHrs); setDurationMins(DEFAULTS.durationMins);
    setGutTraining(DEFAULTS.gutTraining); setIntensity(DEFAULTS.intensity);
    setTargetRateMode(DEFAULTS.targetRateMode); setCustomTargetRate(DEFAULTS.customTargetRate);
    setDrinkServings(DEFAULTS.drinkServings); setCarbsPerServing(DEFAULTS.carbsPerServing);
    setSodiumPerServing(DEFAULTS.sodiumPerServing);
    setSweatRate(DEFAULTS.sweatRate); setSweatSodiumConc(DEFAULTS.sweatSodiumConc);
    setSodiumReplacementPct(DEFAULTS.sodiumReplacementPct);
    setBaseMaltodextrinTbsp(DEFAULTS.baseMaltodextrinTbsp); setBaseSugarTbsp(DEFAULTS.baseSugarTbsp);
    setBasePectinTsp(DEFAULTS.basePectinTsp); setBaseSodiumCitrateTsp(DEFAULTS.baseSodiumCitrateTsp);
    setBaseLemonJuiceTsp(DEFAULTS.baseLemonJuiceTsp); setBaseWaterTbsp(DEFAULTS.baseWaterTbsp);
    setIncludeVanilla(DEFAULTS.includeVanilla); setBaseVanillaTsp(DEFAULTS.baseVanillaTsp);
    setBaseCarbsG(DEFAULTS.baseCarbsG); setSodiumMgPerTspCitrate(DEFAULTS.sodiumMgPerTspCitrate);
    setDoseIntervalMin(DEFAULTS.doseIntervalMin); setMaxCarbsPerDose(DEFAULTS.maxCarbsPerDose);
    setServingSizeG(DEFAULTS.servingSizeG);
    setUiMode("basic");
    // not touching the URL here — same reasoning as the autosave effect above. Hit "Copy
    // shareable link" afterward if you want to share the blank state.
  };

  const paceLabel = plan.paceMinPerUnit === null
    ? "—"
    : `${fmtHM(plan.paceMinPerUnit)} / ${distanceUnit}`;

  const doseWarning = plan.carbsPerDose > plan.maxCarbsPerDose;

  return (
    <div style={{ minHeight: "100vh", background: INK, color: PARCHMENT, fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        .cg-serif { font-family: 'Fraunces', serif; }
        .cg-mono { font-family: 'IBM Plex Mono', monospace; }
        input[type="number"], input[type="text"], select {
          background: ${PANEL_2}; border: 1px solid ${GRID}; color: ${PARCHMENT};
          border-radius: 3px; padding: 7px 9px; font-family: 'IBM Plex Mono', monospace;
          font-size: 13px; width: 100%; box-sizing: border-box;
        }
        select { font-family: 'Inter', sans-serif; font-size: 12px; }
        input:focus, select:focus { outline: none; border-color: ${CITRUS}; }
        .cg-toggle { border: 1px solid ${GRID}; background: transparent; color: ${MUTED}; padding: 8px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; cursor: pointer; }
        .cg-toggle.active { background: ${LIME}; border-color: ${LIME}; color: ${INK}; font-weight: 600; }
        .cg-field-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: ${MUTED}; margin-bottom: 5px; display: block; }
        .cg-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${GRID}; align-items: center; gap: 10px; }
        .cg-row:last-child { border-bottom: none; }
        .cg-section-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .1em; color: ${MUTED}; margin-bottom: 12px; }
        .cg-collapsible-header {
          font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .1em; color: ${MUTED};
          margin-bottom: 12px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;
          background: transparent; border: none; width: 100%; padding: 0; text-align: left;
        }
        .cg-collapsible-header:hover { color: ${CITRUS}; }
        .cg-caret { font-size: 10px; transition: transform 0.15s ease; }
        .cg-panel { background: ${PANEL}; border: 1px solid ${GRID}; border-radius: 6px; padding: 18px; }
        .cg-ingredient { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid ${GRID}; align-items: baseline; }
        .cg-ingredient:last-child { border-bottom: none; }
        .cg-ingredient-name { color: ${PARCHMENT}; font-size: 14px; }
        .cg-ingredient-qty { color: ${CITRUS}; font-weight: 600; font-family: 'IBM Plex Mono', monospace; font-size: 13px; text-align: right; }
        .cg-ingredient-g { color: ${MUTED}; font-size: 11px; margin-left: 6px; }
        .cg-stat { text-align: center; }
        .cg-stat-value { font-family: 'Fraunces', serif; font-size: 26px; font-weight: 600; color: ${LIME}; }
        .cg-stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: ${MUTED}; margin-top: 4px; }
        .cg-warning { background: rgba(199,123,95,0.15); border: 1px solid ${RUST}; border-radius: 4px; padding: 10px 12px; font-size: 12px; color: ${PARCHMENT}; margin-top: 10px; }
        .cg-checkbox-row { display: flex; align-items: center; gap: 8px; }
        .cg-checkbox-row input[type="checkbox"] { width: auto; }
        @media (max-width: 780px) { .cg-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      <div style={{ borderBottom: `1px solid ${GRID}`, padding: "28px 24px 24px", background: `linear-gradient(180deg, ${PANEL_2} 0%, ${INK} 100%)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
          <div className="cg-mono" style={{ fontSize: "11px", letterSpacing: "0.14em", color: CITRUS }}>
            DIY ENERGY GEL — RECIPE CALCULATOR
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <div style={{ display: "flex" }}>
              <button className={`cg-toggle ${uiMode === "basic" ? "active" : ""}`} style={{ borderRight: "none", fontSize: "11px", padding: "6px 10px" }} onClick={() => setUiMode("basic")}>Basic</button>
              <button className={`cg-toggle ${uiMode === "advanced" ? "active" : ""}`} style={{ fontSize: "11px", padding: "6px 10px" }} onClick={() => setUiMode("advanced")}>Advanced</button>
            </div>
            <button className="cg-toggle" style={{ fontSize: "11px", padding: "6px 10px" }} onClick={copyShareLink}>
              {linkCopied ? "✓ Link copied!" : "🔗 Copy shareable link"}
            </button>
            <button className="cg-toggle" style={{ fontSize: "11px", padding: "6px 10px", color: RUST, borderColor: RUST }} onClick={resetToBlank}>Start fresh</button>
          </div>
        </div>

        {shareUrlDisplay && (
          <div style={{ border: `1px solid ${CITRUS}`, borderRadius: "4px", padding: "10px", marginBottom: "14px", background: PANEL_2, display: "flex", gap: "8px", alignItems: "center" }}>
            <input readOnly value={shareUrlDisplay} onFocus={(e) => e.target.select()} className="cg-mono" style={{ flex: 1, fontSize: "11px" }} />
            <button className="cg-toggle" style={{ fontSize: "11px", padding: "6px 10px", flexShrink: 0 }} onClick={() => setShareUrlDisplay(null)}>Close</button>
          </div>
        )}

        <h1 className="cg-serif" style={{ fontSize: "30px", fontWeight: 600, margin: "0 0 6px 0" }}>
          Carb Gel Calculator
        </h1>
        <p style={{ color: MUTED, fontSize: "14px", margin: 0, maxWidth: "620px" }}>
          Scales a homemade maltodextrin gel recipe to the carbs and sodium your specific run needs —
          accounting for what you're already getting from a sports drink.
          {uiMode === "basic" && " Switch to Advanced for sweat/sodium tuning, ingredient ratios, and a dosing schedule."}
        </p>
        <p className="cg-mono" style={{ color: MUTED, fontSize: "11px", margin: "10px 0 0 0", maxWidth: "620px", lineHeight: 1.6 }}>
          No account needed: your numbers autosave in this browser as you go. To use this on another
          device, or send it to someone, tap "Copy shareable link".
        </p>
      </div>

      <div style={{ maxWidth: "980px", margin: "0 auto", padding: "24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }} className="cg-grid">

        {/* LEFT COLUMN: inputs */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="cg-panel">
            <div className="cg-section-label">THE RUN</div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "10px", marginBottom: "10px" }}>
              <div>
                <label className="cg-field-label">Distance</label>
                <input type="number" value={distance} onChange={(e) => setDistance(e.target.value)} />
              </div>
              <div>
                <label className="cg-field-label">Unit</label>
                <select value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value)}>
                  <option value="mi">miles</option>
                  <option value="km">km</option>
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
              <div>
                <label className="cg-field-label">Duration — hours</label>
                <input type="number" value={durationHrs} onChange={(e) => setDurationHrs(e.target.value)} />
              </div>
              <div>
                <label className="cg-field-label">Duration — minutes</label>
                <input type="number" value={durationMins} onChange={(e) => setDurationMins(e.target.value)} />
              </div>
            </div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>Pace</span>
              <span className="cg-mono">{paceLabel}</span>
            </div>
          </div>

          <div className="cg-panel">
            <div className="cg-section-label">CARB TARGET</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
              <div>
                <label className="cg-field-label">Gut training</label>
                <select value={gutTraining} onChange={(e) => setGutTraining(e.target.value)}>
                  <option value="untrained">Untrained / occasional</option>
                  <option value="trained">Trained / regular gel user</option>
                  <option value="veteran">Veteran / multi-carb trained</option>
                </select>
              </div>
              <div>
                <label className="cg-field-label">Effort</label>
                <select value={intensity} onChange={(e) => setIntensity(e.target.value)}>
                  <option value="easy">Easy / long run</option>
                  <option value="moderate">Moderate / steady</option>
                  <option value="hard">Hard / race day</option>
                </select>
              </div>
            </div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>Suggested range</span>
              <span className="cg-mono">{plan.rateGuide.lo}–{plan.rateGuide.hi} g/hr</span>
            </div>
            <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
              <button className={`cg-toggle ${targetRateMode === "auto" ? "active" : ""}`} style={{ flex: 1, fontSize: "11px" }} onClick={() => setTargetRateMode("auto")}>
                Auto ({plan.rateGuide.recommended} g/hr)
              </button>
              <button className={`cg-toggle ${targetRateMode === "custom" ? "active" : ""}`} style={{ flex: 1, fontSize: "11px" }} onClick={() => setTargetRateMode("custom")}>
                Custom
              </button>
            </div>
            {targetRateMode === "custom" && (
              <div style={{ marginTop: "10px" }}>
                <label className="cg-field-label">Target carb rate (g/hr)</label>
                <input type="number" value={customTargetRate} onChange={(e) => setCustomTargetRate(e.target.value)} />
              </div>
            )}
          </div>

          <div className="cg-panel">
            <div className="cg-section-label">OTHER CARB &amp; SODIUM SOURCES</div>
            <div style={{ marginBottom: "10px" }}>
              <label className="cg-field-label">Sports drink servings during the run (12 fl oz each)</label>
              <input type="number" value={drinkServings} onChange={(e) => setDrinkServings(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label className="cg-field-label">Carbs / serving (g)</label>
                <input type="number" value={carbsPerServing} onChange={(e) => setCarbsPerServing(e.target.value)} />
              </div>
              <div>
                <label className="cg-field-label">Sodium / serving (mg)</label>
                <input type="number" value={sodiumPerServing} onChange={(e) => setSodiumPerServing(e.target.value)} />
              </div>
            </div>
          </div>

          {uiMode === "advanced" && (
            <div className="cg-panel">
              <button className="cg-collapsible-header" onClick={() => toggle("sweatSodium")}>
                SWEAT &amp; SODIUM SETTINGS
                <span className="cg-caret">{expanded.sweatSodium ? "▾" : "▸"}</span>
              </button>
              {expanded.sweatSodium && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                    <div>
                      <label className="cg-field-label">Sweat rate (L/hr)</label>
                      <input type="number" value={sweatRate} onChange={(e) => setSweatRate(e.target.value)} />
                    </div>
                    <div>
                      <label className="cg-field-label">Sweat sodium (mg/L)</label>
                      <input type="number" value={sweatSodiumConc} onChange={(e) => setSweatSodiumConc(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="cg-field-label">Sodium replacement target (% of sweat loss)</label>
                    <input type="number" value={sodiumReplacementPct} onChange={(e) => setSodiumReplacementPct(e.target.value)} />
                  </div>
                  <p style={{ fontSize: "11px", color: MUTED, marginTop: "8px", lineHeight: 1.5 }}>
                    Sweat rate and sweat sodium concentration vary a lot by person, heat, and acclimation
                    (roughly 0.5–2.5 L/hr and 200–2000 mg/L are both realistic ranges). Full 100% replacement
                    isn't required — many athletes target 50–80%.
                  </p>
                </>
              )}
            </div>
          )}

          {uiMode === "advanced" && (
            <div className="cg-panel">
              <button className="cg-collapsible-header" onClick={() => toggle("recipeBase")}>
                RECIPE BASE (1× BATCH)
                <span className="cg-caret">{expanded.recipeBase ? "▾" : "▸"}</span>
              </button>
              {expanded.recipeBase && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                    <div>
                      <label className="cg-field-label">Maltodextrin (tbsp)</label>
                      <input type="number" value={baseMaltodextrinTbsp} onChange={(e) => setBaseMaltodextrinTbsp(e.target.value)} />
                    </div>
                    <div>
                      <label className="cg-field-label">Granulated sugar (tbsp)</label>
                      <input type="number" value={baseSugarTbsp} onChange={(e) => setBaseSugarTbsp(e.target.value)} />
                    </div>
                    <div>
                      <label className="cg-field-label">Pectin (tsp)</label>
                      <input type="number" value={basePectinTsp} onChange={(e) => setBasePectinTsp(e.target.value)} />
                    </div>
                    <div>
                      <label className="cg-field-label">Sodium citrate (tsp)</label>
                      <input type="number" value={baseSodiumCitrateTsp} onChange={(e) => setBaseSodiumCitrateTsp(e.target.value)} />
                    </div>
                    <div>
                      <label className="cg-field-label">Lemon juice (tsp)</label>
                      <input type="number" value={baseLemonJuiceTsp} onChange={(e) => setBaseLemonJuiceTsp(e.target.value)} />
                    </div>
                    <div>
                      <label className="cg-field-label">Water (tbsp)</label>
                      <input type="number" value={baseWaterTbsp} onChange={(e) => setBaseWaterTbsp(e.target.value)} />
                    </div>
                  </div>
                  <div className="cg-checkbox-row" style={{ marginBottom: "10px" }}>
                    <input type="checkbox" id="cg-vanilla" checked={includeVanilla} onChange={(e) => setIncludeVanilla(e.target.checked)} />
                    <label htmlFor="cg-vanilla" style={{ fontSize: "12px" }}>Include vanilla extract</label>
                  </div>
                  {includeVanilla && (
                    <div style={{ marginBottom: "10px" }}>
                      <label className="cg-field-label">Vanilla extract (tsp)</label>
                      <input type="number" value={baseVanillaTsp} onChange={(e) => setBaseVanillaTsp(e.target.value)} />
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div>
                      <label className="cg-field-label">This batch yields (g carbs)</label>
                      <input type="number" value={baseCarbsG} onChange={(e) => setBaseCarbsG(e.target.value)} />
                    </div>
                    <div>
                      <label className="cg-field-label">mg sodium / tsp sodium citrate</label>
                      <input type="number" value={sodiumMgPerTspCitrate} onChange={(e) => setSodiumMgPerTspCitrate(e.target.value)} />
                    </div>
                  </div>
                  <p style={{ fontSize: "11px", color: MUTED, marginTop: "8px", lineHeight: 1.5 }}>
                    Defaults match the recipe: 8 tbsp maltodextrin, 1 tbsp sugar, ¼ tsp pectin, ¼ tsp
                    sodium citrate, 2 tsp lemon juice, ~5½ tbsp water, optional ⅛ tsp vanilla — roughly
                    80g carbs and ~260mg sodium. Sodium-per-tsp varies by product form (anhydrous vs.
                    dihydrate); check your own label if precise dosing matters.
                  </p>
                </>
              )}
            </div>
          )}

          {uiMode === "advanced" && (
            <div className="cg-panel">
              <button className="cg-collapsible-header" onClick={() => toggle("dosing")}>
                DOSING &amp; PACKAGING
                <span className="cg-caret">{expanded.dosing ? "▾" : "▸"}</span>
              </button>
              {expanded.dosing && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label className="cg-field-label">Minutes between doses</label>
                    <input type="number" value={doseIntervalMin} onChange={(e) => setDoseIntervalMin(e.target.value)} />
                  </div>
                  <div>
                    <label className="cg-field-label">Comfort ceiling / dose (g)</label>
                    <input type="number" value={maxCarbsPerDose} onChange={(e) => setMaxCarbsPerDose(e.target.value)} />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label className="cg-field-label">Flask / pouch serving size (g)</label>
                    <input type="number" value={servingSizeG} onChange={(e) => setServingSizeG(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: results */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="cg-panel">
            <div className="cg-section-label">CARB PLAN</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "14px" }}>
              <div className="cg-stat">
                <div className="cg-stat-value">{fmtG(plan.totalCarbsNeeded)}</div>
                <div className="cg-stat-label">Total needed</div>
              </div>
              <div className="cg-stat">
                <div className="cg-stat-value">{fmtG(plan.carbsFromDrink)}</div>
                <div className="cg-stat-label">From drink</div>
              </div>
              <div className="cg-stat">
                <div className="cg-stat-value">{fmtG(plan.carbsNeededFromGel)}</div>
                <div className="cg-stat-label">From gel</div>
              </div>
            </div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>Run duration</span>
              <span className="cg-mono">{fmtHM(plan.durationMinutes)}</span>
            </div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>Target intake rate</span>
              <span className="cg-mono">{Math.round(plan.targetRate)} g/hr</span>
            </div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>Recipe batches needed</span>
              <span className="cg-mono">{plan.carbMultiplier.toFixed(2)}×</span>
            </div>
          </div>

          <div className="cg-panel">
            <div className="cg-section-label">YOUR SCALED RECIPE</div>
            <div className="cg-ingredient">
              <span className="cg-ingredient-name">Maltodextrin</span>
              <span className="cg-ingredient-qty">{fmtQty(plan.maltodextrinTbsp, "tbsp")}<span className="cg-ingredient-g">≈{fmtG(plan.maltodextrinTbsp * GRAMS_PER_TBSP.maltodextrin)}</span></span>
            </div>
            <div className="cg-ingredient">
              <span className="cg-ingredient-name">Granulated sugar</span>
              <span className="cg-ingredient-qty">{fmtQty(plan.sugarTbsp, "tbsp")}<span className="cg-ingredient-g">≈{fmtG(plan.sugarTbsp * GRAMS_PER_TBSP.sugar)}</span></span>
            </div>
            <div className="cg-ingredient">
              <span className="cg-ingredient-name">Pectin</span>
              <span className="cg-ingredient-qty">{fmtQty(plan.pectinTsp, "tsp")}<span className="cg-ingredient-g">≈{fmtG(plan.pectinTsp * GRAMS_PER_TSP.pectin)}</span></span>
            </div>
            <div className="cg-ingredient">
              <span className="cg-ingredient-name">Sodium citrate</span>
              <span className="cg-ingredient-qty">{fmtQty(plan.sodiumCitrateTsp, "tsp")}<span className="cg-ingredient-g">≈{fmtG(plan.sodiumCitrateTsp * GRAMS_PER_TSP.sodiumCitrate)}</span></span>
            </div>
            <div className="cg-ingredient">
              <span className="cg-ingredient-name">Lemon juice</span>
              <span className="cg-ingredient-qty">{fmtQty(plan.lemonJuiceTsp, "tsp")}<span className="cg-ingredient-g">≈{fmtG(plan.lemonJuiceTsp * GRAMS_PER_TSP.lemonJuice)}</span></span>
            </div>
            <div className="cg-ingredient">
              <span className="cg-ingredient-name">Water</span>
              <span className="cg-ingredient-qty">{fmtQty(plan.waterTbsp, "tbsp")}<span className="cg-ingredient-g">≈{fmtG(plan.waterTbsp * GRAMS_PER_TBSP.water)}</span></span>
            </div>
            {includeVanilla && (
              <div className="cg-ingredient">
                <span className="cg-ingredient-name">Vanilla extract</span>
                <span className="cg-ingredient-qty">{fmtQty(plan.vanillaTsp, "tsp")}<span className="cg-ingredient-g">≈{fmtG(plan.vanillaTsp * GRAMS_PER_TSP.vanilla)}</span></span>
              </div>
            )}
            <div className="cg-row" style={{ marginTop: "6px" }}>
              <span style={{ color: MUTED, fontSize: "12px" }}>Total yield</span>
              <span className="cg-mono" style={{ fontSize: "12px" }}>≈{fmtG(plan.totalMassG)} · {plan.numServings.toFixed(1)} × {servingSizeG}g pouches</span>
            </div>
            {plan.sodiumMultiplier === 0 && plan.sodiumNeededFromGel === 0 && plan.targetSodiumReplacement > 0 && (
              <p style={{ fontSize: "11px", color: LIME, marginTop: "8px" }}>
                Your sports drink already covers your sodium target — this batch skips sodium citrate entirely.
              </p>
            )}
          </div>

          <div className="cg-panel">
            <div className="cg-section-label">SODIUM PLAN</div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>Estimated sweat sodium loss</span>
              <span className="cg-mono">{fmtMg(plan.totalSodiumLoss)}</span>
            </div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>Replacement target</span>
              <span className="cg-mono">{fmtMg(plan.targetSodiumReplacement)}</span>
            </div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>From sports drink</span>
              <span className="cg-mono">{fmtMg(plan.sodiumFromDrink)}</span>
            </div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>Needed from gel</span>
              <span className="cg-mono">{fmtMg(plan.sodiumNeededFromGel)}</span>
            </div>
          </div>

          <div className="cg-panel">
            <div className="cg-section-label">FEED SCHEDULE</div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>Doses</span>
              <span className="cg-mono">{plan.numDoses} every {plan.doseIntervalMin} min</span>
            </div>
            <div className="cg-row" style={{ fontSize: "12px" }}>
              <span style={{ color: MUTED }}>Carbs per dose</span>
              <span className="cg-mono">{fmtG(plan.carbsPerDose)}</span>
            </div>
            {doseWarning && (
              <div className="cg-warning">
                {fmtG(plan.carbsPerDose)} per dose is above your {plan.maxCarbsPerDose}g comfort ceiling —
                shorten the interval between doses to spread the same total out more.
              </div>
            )}
            {uiMode === "advanced" && plan.numDoses > 0 && (
              <div style={{ maxHeight: "180px", overflowY: "auto", marginTop: "10px", border: `1px solid ${GRID}`, borderRadius: "4px" }}>
                {doseSchedule.map((d) => (
                  <div key={d.n} className="cg-row" style={{ padding: "6px 10px", fontSize: "11px" }}>
                    <span style={{ color: MUTED }}>Dose {d.n} @ {fmtHM(d.atMinute)}</span>
                    <span className="cg-mono">{fmtG(d.carbs)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "980px", margin: "0 auto", padding: "0 24px 40px", color: MUTED, fontSize: "11px", lineHeight: 1.6 }}>
        Not medical or nutrition advice — ingredient gram weights and sodium-citrate sodium content are
        approximate and vary by brand/measuring technique. Test any new gel and dosing schedule in
        training before race day.
      </div>
    </div>
  );
}

export default CarbGelCalculator;
