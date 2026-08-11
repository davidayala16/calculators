// A range input whose track is a "cold to hot" thermal gradient (blue → violet → red),
// purely as a visual cue for where the value sits between its min and max — it carries no
// meaning about which of rent/buy is "better." Deliberately its own gradient story (not
// NYT's purple/teal duotone): a three-stop blue-violet-red thermal ramp.
export default function GradientSlider({ label, value, min, max, step = 1, onChange, formatValue, helpText }) {
  const numeric = Number(value);
  const pct = max > min ? ((numeric - min) / (max - min)) * 100 : 0;
  const clampedPct = Math.min(Math.max(Number.isFinite(pct) ? pct : 0, 0), 100);

  return (
    <div className="rvb-slider-wrap">
      <div className="rvb-slider-header">
        <span className="rvb-field-label">{label}</span>
        <span className="rvb-mono rvb-slider-value">{formatValue ? formatValue(numeric) : numeric}</span>
      </div>
      <div className="rvb-slider-track">
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
