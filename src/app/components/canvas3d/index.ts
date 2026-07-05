// Barrel for the 3D scene components (stroke→3D round-trip, plan §2).
// Default export preserved so React.lazy(() => import('./canvas3d')) works.
// NOTE for the wiring layer: importing VALUES from this barrel pulls three
// into the importer's chunk — main-chunk code must use type-only imports or
// the pure data modules (modeParams.ts / materials3d.ts) directly.
export { Stroke3DScene, default } from './Stroke3DScene';
export type { Stroke3DSceneProps } from './Stroke3DScene';
// Mode types re-exported for the wiring layer's chrome (full D-7 set).
export type { GeometryMode, GeometryModeSetting } from '../../lib/geometry3d/strokeTo3d';
// Round-7 chrome-split surface (3d-mode-controls-spec): per-mode params +
// material presets + hatch inputs.
export type { HatchInputs, HatchVariant, HatchGrammar, HatchDirection } from './hatchMaterial';
export type {
  ExtrudeBevelProfile3D,
  ExtrudeParams3D,
  ExtrudeSideWall3D,
  InflateParams3D,
  InflateProfileFamily3D,
  Mode3DParams,
  RodCapStyle3D,
  RodJointStyle3D,
  RodParams3D,
  SolidEdge3D,
  SolidParams3D,
} from './modeParams';
export type { MaterialPresetId, NativeProps3D } from './materials3d';
