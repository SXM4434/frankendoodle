import { useLayoutEffect, type ReactNode } from 'react';
import { F3SvgStyleProvider, useF3SvgStyle, type F3SvgStyle } from '../../state/F3SvgStyleContext';
import {
  F3RoughModifiersProvider,
  useF3RoughModifiers,
  type F3ModifiersState,
} from '../../state/F3RoughModifiersContext';

// Render a subtree pinned to a specific full Desk-Doodles style config
// (SVG style + every modifier). Each Frankendoodle piece can differ, so each
// gets its own fresh provider scope. SvgStyleTransform inside reads both.

function ConfigSetter({ svgStyle, mods }: { svgStyle: F3SvgStyle; mods: F3ModifiersState }) {
  const s = useF3SvgStyle();
  const m = useF3RoughModifiers();
  useLayoutEffect(() => {
    s.setState(svgStyle);
  }, [svgStyle, s]);
  useLayoutEffect(() => {
    m.replace(mods);
  }, [mods, m]);
  return null;
}

export function StyleScope({
  svgStyle,
  mods,
  children,
}: {
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  children: ReactNode;
}) {
  return (
    <F3SvgStyleProvider>
      <F3RoughModifiersProvider>
        <ConfigSetter svgStyle={svgStyle} mods={mods} />
        {children}
      </F3RoughModifiersProvider>
    </F3SvgStyleProvider>
  );
}
