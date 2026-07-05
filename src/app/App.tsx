import React from 'react';
import { RouterProvider } from 'react-router';
import { router } from './routes';
import {
  DirectionModeProvider,
  useDirectionMode,
  directionAttr,
} from './state/DirectionModeContext';
import { F3SvgStyleProvider } from './state/F3SvgStyleContext';
import { F3RoughModifiersProvider } from './state/F3RoughModifiersContext';
import { TextureFilterDefs } from './components/canvas/SvgStyleTransform';

function DirectionScope({ children }: { children: React.ReactNode }) {
  const { state } = useDirectionMode();
  return <div data-direction={directionAttr(state)}>{children}</div>;
}

export default function App() {
  return (
    <DirectionModeProvider>
      <DirectionScope>
        <F3SvgStyleProvider>
          <F3RoughModifiersProvider devHook>
            <TextureFilterDefs />
            <RouterProvider router={router} />
          </F3RoughModifiersProvider>
        </F3SvgStyleProvider>
      </DirectionScope>
    </DirectionModeProvider>
  );
}
