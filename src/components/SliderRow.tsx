import React from 'react';

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  suffix?: string;
  onChange: (v: number) => void;
  /** Show a warning when value is near extreme ends of range */
  warnThreshold?: number;
}

/**
 * SliderRow — label + range slider + value display.
 * Fixes the original UI bug: value display reflects actual slider value
 * (not a stale HTML default that differs from the renderer initial state).
 */
const SliderRow: React.FC<SliderRowProps> = ({
  label, value, min, max, step, decimals = 1, suffix = '', onChange, warnThreshold,
}) => {
  const clampedVal = Math.max(min, Math.min(max, value));
  const pct = (clampedVal - min) / (max - min);
  const isWarn = warnThreshold !== undefined && (pct < warnThreshold || pct > 1 - warnThreshold);

  return (
    <div className="control-row">
      <label title={label}>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clampedVal}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
      <span className={`value-display${isWarn ? ' warn' : ''}`}>
        {clampedVal.toFixed(decimals)}{suffix}
      </span>
    </div>
  );
};

export default SliderRow;
