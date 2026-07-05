import { IS } from '../../lib/typography';

// Chrome slider primitive for numeric modifiers.
// Same visual register as Dropdown but for continuous values.
//
// Renders a label + value readout + native <input type="range"> styled to
// the rest of the chrome (W1 token palette, IS font).

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  width?: number | string;
  /** Optional units (e.g., 'px', '°', '%'). Displayed after value. */
  unit?: string;
  /** Number of decimal places to display in readout. Defaults inferred from step. */
  precision?: number;
  /** Optional hover tooltip on the whole row (native title attr). */
  title?: string;
};

export function Slider({ label, value, min, max, step, onChange, width = '100%', unit, precision, title }: SliderProps) {
  // Infer precision from step if not provided
  const inferredPrecision = precision !== undefined ? precision : (() => {
    if (step >= 1) return 0;
    const s = step.toString();
    const dot = s.indexOf('.');
    return dot >= 0 ? s.length - dot - 1 : 0;
  })();
  const displayValue = value.toFixed(inferredPrecision);

  return (
    <div
      title={title}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 2,
        width,
        padding: '2px 0',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span
          style={{
            fontFamily: IS,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--dir-text-secondary)',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: IS,
            fontSize: 10,
            fontWeight: 500,
            color: 'var(--dir-text-primary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {displayValue}{unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        className="dd-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          height: 14,
          cursor: 'pointer',
        }}
      />
    </div>
  );
}
