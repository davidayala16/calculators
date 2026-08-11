// A range input paired with an editable number field, and a track rendered as discrete
// color blocks (not a smooth blend) — a "boxy" thermal gradient (blue → violet → red) as a
// live indicator of which direction on THIS slider currently favors buying vs. renting, given
// every other input's current value. `reversed` flips which end is which — the direction that
// helps buying isn't fixed to "higher" or "lower" for every field (e.g. more down payment can
// help buying or renting depending on the mortgage-rate/investment-return spread), so the
// caller computes that per-render via a quick sensitivity check and tells us which way to draw it.
const GRADIENT_STOPS = [
  { pos: 0, rgb: [46, 107, 224] },   // cold blue — favors renting
  { pos: 0.5, rgb: [155, 79, 224] }, // violet
  { pos: 1, rgb: [224, 71, 59] },    // hot red — favors buying
];
const SEGMENT_COUNT = 26;

function segmentColor(t) {
  const clamped = Math.min(Math.max(t, 0), 1);
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    const a = GRADIENT_STOPS[i];
    const b = GRADIENT_STOPS[i + 1];
    if (clamped >= a.pos && clamped <= b.pos) {
      const localT = b.pos > a.pos ? (clamped - a.pos) / (b.pos - a.pos) : 0;
      const r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * localT);
      const g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * localT);
      const bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * localT);
      return `rgb(${r}, ${g}, ${bl})`;
    }
  }
  const last = GRADIENT_STOPS[GRADIENT_STOPS.length - 1].rgb;
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`;
}

const FORWARD_SEGMENTS = Array.from({ length: SEGMENT_COUNT }, (_, i) => segmentColor(i / (SEGMENT_COUNT - 1)));
const REVERSED_SEGMENTS = [...FORWARD_SEGMENTS].reverse();

export default function GradientSlider({ label, value, min, max, step = 1, onChange, prefix, suffix, derived, helpText, reversed = false }) {
  const numeric = Number(value);
  const pct = max > min ? ((numeric - min) / (max - min)) * 100 : 0;
  const clampedPct = Math.min(Math.max(Number.isFinite(pct) ? pct : 0, 0), 100);
  const segments = reversed ? REVERSED_SEGMENTS : FORWARD_SEGMENTS;

  return (
    <div className="rvb-slider-wrap">
      <div className="rvb-slider-header">
        <span className="rvb-field-label">{label}</span>
        <div className="rvb-slider-input-group">
          {prefix && <span className="rvb-slider-adornment">{prefix}</span>}
          <input
            type="number"
            className="rvb-slider-number"
            // Deliberately the raw `value` prop, not a Number()-coerced fallback — coercing
            // an in-progress empty string back to 0 (Number("") === 0, which is finite) was
            // exactly what made a cleared field snap back to "0" instead of staying blank
            // while typing a replacement.
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(e.target.value)}
          />
          {suffix && <span className="rvb-slider-adornment">{suffix}</span>}
          {derived && <span className="rvb-mono rvb-slider-derived">{derived(numeric)}</span>}
        </div>
      </div>
      <div className="rvb-slider-track-wrap">
        <div className="rvb-slider-track">
          {segments.map((color, i) => (
            <div key={i} className="rvb-slider-segment" style={{ background: color }} />
          ))}
        </div>
        <div className="rvb-slider-fill-marker" style={{ left: `${clampedPct}%` }} />
        <input
          type="range"
          className="rvb-slider-input"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(numeric) ? numeric : min}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {helpText && <div className="rvb-slider-help">{helpText}</div>}
    </div>
  );
}
