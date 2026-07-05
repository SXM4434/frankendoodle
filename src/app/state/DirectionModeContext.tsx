import React, { createContext, useContext, useState } from 'react';

/**
 * Direction Mode — W1 light ↔ W1-D dark companion.
 *
 * Opened 2026-05-25 as step B2 of the W1-D Dark Companion lab sequence.
 * Plan doc: `docs/labs/color/w1-dark-companion/w1-dark-companion-research-plan.md`.
 *
 * Behavior:
 *   - `light` (default) → root data-direction = "w1"        (W1 Near-White Hold locked)
 *   - `dark`            → root data-direction = "w1-d"      (W1-D Dark Companion prototype)
 *
 * Both directions resolve through the same `--dir-*` token namespace defined
 * in `src/styles/theme.css`. Components do not branch on this value; they
 * just consume `var(--dir-*)` and the tokens resolve to the active set.
 *
 * Opt-in only. No `prefers-color-scheme` wiring at this step (that's B4 /
 * production ship). User must explicitly flip the toggle in LabShell chrome.
 * Default stays `light` so W1 light is the canonical first paint.
 */
export type DirectionMode = 'light' | 'dark';

type ContextValue = {
  state: DirectionMode;
  setState: (v: DirectionMode) => void;
};

const DirectionModeContext = createContext<ContextValue>({
  state: 'light',
  setState: () => {},
});

export function DirectionModeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DirectionMode>('light');
  return (
    <DirectionModeContext.Provider value={{ state, setState }}>
      {children}
    </DirectionModeContext.Provider>
  );
}

export function useDirectionMode() {
  return useContext(DirectionModeContext);
}

/**
 * Helper: map mode → `data-direction` attribute value consumed by theme.css.
 */
export function directionAttr(mode: DirectionMode): 'w1' | 'w1-d' {
  return mode === 'dark' ? 'w1-d' : 'w1';
}
