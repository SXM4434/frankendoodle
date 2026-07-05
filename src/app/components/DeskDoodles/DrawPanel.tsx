import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IS, ISe } from '../../lib/typography';
import { PAPER_GRAIN, WARM_POOL } from '../../lib/deskCraft';
import { PILL, CTA, SECTION_LABEL, RAISED_SHADOW } from '../../lib/chromeStyles';
import { Live3DMount } from './DeskObject3DMount';
import { Canvas3DProvider, useCanvas3D } from '../../state/Canvas3DContext';
import { Canvas3DChrome } from '../chrome/Canvas3DChrome';
import { runMesh, isHardPathEnabled } from '../../lib/hardPath';
import {
  DrawSurface,
  strokesToObjectMarkup,
  capStrokes,
  capToneFills,
  prepareBackdrop,
  composeBackdropAndStrokes,
  SHADE_TOOL_DEFAULT,
  type ShadeToolState,
  type ToneFill,
  type BackdropFrame,
  type Stroke,
  type StrokePoint,
  type ShapeSnapApi,
} from './DrawSurface';
import { DrawToolbar } from './DrawToolbar';
import { type ShapeCandidate, type ShapeFitResult, type SnapAction } from '../../lib/draw/shapeFit';
import { SwitchPopover } from './SwitchPopover';
import { ShapeStrip } from './ShapeStrip';
import { buildSwitchSet, type ShapeOverride, type SwitchEntry } from '../../lib/draw/switchSet';
import { generateShape } from '../../lib/draw/shapeLibrary';
import { pushShapeSnapEntry, type ShapeSnapOutcome } from '../../lib/shapeSnapLog';
import { COVERAGE_BANDS } from '../../lib/smart/coverage';
import {
  prepareSvgUpload,
  applyUploadSimplify,
  defaultSimplifyMode,
  type UploadSimplifyMode,
} from '../../lib/svgUpload';
import { simplifyToSketch } from '../../lib/simplifyToSketch';
import { imageToSvg, isRasterImageFile } from '../../lib/imageToSvg';
import { normalizeSvgSize } from '../../lib/normalizeInput';
import { monochromeSvgMarkup } from '../../lib/monochromeSvg';
import { svgMarkupToStrokes } from '../../lib/svgToStrokes';
import { Dropdown } from '../chrome/Dropdown';
import { Slider } from '../chrome/Slider';
import { SLIDER_SPECS, MODIFIER_SETS_BY_STYLE, UNIVERSAL_MODIFIERS } from '../chrome/modifierSpecs';
import {
  F3SvgStyleProvider,
  useF3SvgStyle,
  F3_SVG_STYLES,
  type F3SvgStyle,
} from '../../state/F3SvgStyleContext';
import {
  F3RoughModifiersProvider,
  useF3RoughModifiers,
  DEFAULT_MODIFIERS,
  type F3ModifiersState,
} from '../../state/F3RoughModifiersContext';
import { applyStylePreset, SvgStyleTransform } from '../canvas/SvgStyleTransform';
import { SurfaceControls } from './ObjectSurface';
import {
  smartPickFromMarkup,
  logSmartPickUndo,
  logSmartPickOverridden,
  type SmartPick,
  type SmartPickResult,
} from '../../lib/smart/smartPick';

type PanelInput = 'draw' | 'upload-svg' | 'upload-image';

// ─── DrawPanel — modal popup hosting DrawSurface for the real desk flow ──────
// Per docs/memory/project_desk_doodles_draw_panel_vs_desk_canvas.md: the draw
// panel is a popup that produces ONE object per Done. DeskPage owns the
// objects array; this panel only captures strokes and hands back markup.
// The panel unmounts on close, so its stroke state clears automatically —
// every open is a fresh draw session.
//
// CREATE-AS-MINI-DESK (Sebs 2026-06-11, ratified): the popup uses the same
// side-by-side grammar as the Sandbox surface — drawing canvas on the LEFT,
// pen controls column on the RIGHT. The column reads/writes the SAME
// F3SvgStyleContext + F3RoughModifiersContext the desk panel uses (D-7: two
// surfaces, ONE pen — values set here are the values the desk panel shows,
// and the next doodle renders with them at Done).


/** Tabbable elements inside the dialog, in DOM order. Computed fresh per
 *  keypress so input-mode switches (draw ↔ upload) and disabled-state flips
 *  (Done) never leave the trap holding a stale list. display:none elements
 *  (the hidden file input) return zero client rects and drop out. */
function getFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]'),
  ).filter(
    (el) =>
      !el.hasAttribute('disabled') && el.tabIndex !== -1 && el.getClientRects().length > 0,
  );
}

// ─── SmartPickChip — the visible receipt (SD-2 option b) ─────────────────────
// "smart picked sketchy + hachure — all linework, no fills" + a quiet undo.
// Pill grammar per chromeStyles (CHIP-adjacent badge, sentence-case because
// the receipt is a sentence, not a label); accent DOT (not an accent tint —
// no accent-ink backgrounds per system rules) marks it as a system act.
// `fading` = the pick was overridden (manual pen move / input removed) — the
// chip quietly fades out and stops accepting clicks; the undo it carried is
// gone WITH the claim (undo only exists while the pick is the active truth).
function SmartPickChip({
  pick,
  onUndo,
  fading = false,
}: {
  pick: SmartPick;
  onUndo: () => void;
  fading?: boolean;
}) {
  return (
    <div
      role="status"
      data-smart-pick-chip
      data-fading={fading ? '1' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderRadius: 999,
        border: '1px solid var(--dir-border)',
        background: 'var(--dir-bg)',
        padding: '6px 12px',
        minWidth: 0,
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.22s ease',
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--dir-accent)', flexShrink: 0 }}
      />
      <span
        style={{
          fontFamily: IS,
          fontSize: 11,
          color: 'var(--dir-text-body)',
          lineHeight: 1.45,
          minWidth: 0,
        }}
      >
        smart picked{' '}
        <strong style={{ fontWeight: 600, color: 'var(--dir-text-primary)' }}>{pick.headline}</strong>
        {' — '}
        {pick.reason}
      </span>
      <button
        onClick={onUndo}
        title="Put the pen back the way it was"
        style={{
          fontFamily: IS,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--dir-text-secondary)',
          background: 'transparent',
          border: 'none',
          textDecoration: 'underline',
          textUnderlineOffset: 2,
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
      >
        undo
      </button>
    </div>
  );
}

// (SnapChip moved into the shared DrawToolbar — Phase 0 extraction.)

// ─── Size-cap honesty ─────────────────────────────────────────────────────────
// The server INSERT path enforces char_length(svg) ≤ 65536 (publish_to_open_desk
// + harden-v1: 64KB). Place checks the staged markup against the same number so
// an over-cap doodle is never silently dropped by the database — the user gets
// the honest note + a real Shrink-to-fit lever and STAYS in the popup.
const SVG_CHAR_CAP = 65536;

/** Sync bridge between the panel's live pen values and the NESTED providers
 *  wrapping the staged minting preview — the SurfaceRenderScope pattern from
 *  ObjectSurface.tsx (~line 149). Mirrored, not imported: it isn't exported
 *  there and that file belongs to another work rock. Runs INSIDE the nested
 *  scope, so setState/replace touch only the preview's shadowed context —
 *  never the global pen. useLayoutEffect lands the sync before paint (no
 *  flash of provider-default style); the !== guards settle in one pass
 *  (replace stores the same object reference). */
function StagedRenderScope({
  svgStyle,
  mods,
  children,
}: {
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  children: ReactNode;
}) {
  const styleCtx = useF3SvgStyle();
  const modsCtx = useF3RoughModifiers();
  useLayoutEffect(() => {
    if (styleCtx.state !== svgStyle) styleCtx.setState(svgStyle);
  }, [styleCtx, svgStyle]);
  useLayoutEffect(() => {
    if (modsCtx.state !== mods) modsCtx.replace(mods);
  }, [modsCtx, mods]);
  return <>{children}</>;
}

/** Drives the modal's Canvas3DContext aiMeshActive flag from hardMeshUrl (mirror of
 *  ObjectSurface's private AiMeshActiveSync) — gates the AI-mesh material toggle in
 *  Canvas3DChrome so it only appears AFTER a mesh is generated. Runs INSIDE the
 *  Canvas3DProvider so it touches only this modal's 3D context. */
function AiMeshActiveSync({ active }: { active: boolean }) {
  const { setAiMeshActive } = useCanvas3D();
  useEffect(() => {
    setAiMeshActive(active);
  }, [active, setAiMeshActive]);
  return null;
}

/** The AI mesh's OWN control set (Sebs 2026-06-16: "ai mesh needs its own custom
 *  set of toggles that make sense for the mesh + our app") — Generate/regenerate,
 *  then Material (greyscale/original) · Darkness · Auto-spin. Distinct from the
 *  local Native/Hatch/Matte-Clay controls (a foreign GLB can't take geometry
 *  styles). Lives inside the modal's Canvas3DProvider so useCanvas3D is live. */
function AiMeshControls({
  hardMeshUrl,
  meshStatus,
  onGenerate,
}: {
  hardMeshUrl: string | null;
  meshStatus: string | null;
  onGenerate: () => void;
}) {
  const { aiMeshMaterialMode, setAiMeshMaterialMode, aiMeshDark, setAiMeshDark, aiMeshAutoSpin, setAiMeshAutoSpin } = useCanvas3D();
  const working = meshStatus === 'working';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <button
          onClick={onGenerate}
          disabled={working}
          style={{
            ...PILL,
            width: '100%',
            justifyContent: 'center',
            padding: '10px 14px',
            fontSize: 12,
            background: hardMeshUrl ? 'var(--dir-raised)' : 'var(--dir-text-primary)',
            color: hardMeshUrl ? 'var(--dir-text-primary)' : 'var(--dir-bg)',
            border: hardMeshUrl ? '1px solid var(--dir-border)' : 'none',
            cursor: working ? 'wait' : 'pointer',
            opacity: working ? 0.7 : 1,
          }}
        >
          {working
            ? 'Generating AI mesh… (~30–90s)'
            : hardMeshUrl
              ? '✓ AI mesh ready — regenerate'
              : meshStatus === 'failed'
                ? 'Generation failed — tap to retry'
                : '✨ Generate AI 3D (hard path)'}
        </button>
        <p style={{ fontFamily: IS, fontSize: 10.5, color: meshStatus === 'failed' ? 'var(--dir-accent)' : 'var(--dir-text-body-soft)', margin: '6px 2px 0', lineHeight: 1.45 }}>
          {working
            ? 'Sending your original photo to the AI mesh generator (TRELLIS)…'
            : meshStatus === 'failed'
              ? 'The generator didn’t return a mesh — tap to try again.'
              : 'Sends your original photo to the AI mesh generator (TRELLIS), ~30–90s + costs a gen.'}
        </p>
      </div>
      {hardMeshUrl && !working && (
        <>
          <span style={{ ...SECTION_LABEL, marginTop: 4 }}>AI mesh look</span>
          <Dropdown
            label="Material"
            value={aiMeshMaterialMode}
            sections={[
              {
                heading: 'AI mesh material',
                subheading: 'How the generated mesh is shaded — value, never hue.',
                options: [
                  { value: 'greyscale', label: 'Greyscale (ours)', detail: 'Desaturate to dark greyscale so the AI mesh sits in our ink register and fits the desk.' },
                  { value: 'og-pbr', label: 'Original (PBR)', detail: "Keep the provider's photoreal materials untouched." },
                ],
              },
            ]}
            onChange={(v) => setAiMeshMaterialMode(v as 'greyscale' | 'og-pbr')}
            popoverWidth={300}
          />
          <Slider
            label="Darkness"
            value={aiMeshDark}
            min={0.05}
            max={1}
            step={0.01}
            precision={2}
            title="How dark the greyscale re-skin reads (value in the ink register)."
            onChange={setAiMeshDark}
          />
          <button
            onClick={() => setAiMeshAutoSpin(!aiMeshAutoSpin)}
            aria-pressed={aiMeshAutoSpin}
            style={{ ...PILL, justifyContent: 'space-between', padding: '8px 14px', fontSize: 12, background: 'var(--dir-bg)', border: '1px solid var(--dir-border)' }}
          >
            <span>Auto-spin</span>
            <span style={{ fontFamily: IS, fontSize: 11, color: aiMeshAutoSpin ? 'var(--dir-text-primary)' : 'var(--dir-text-body-soft)' }}>{aiMeshAutoSpin ? 'On' : 'Off'}</span>
          </button>
        </>
      )}
    </div>
  );
}

// Opaque cover for the canvas pane — the gate idiom (DrawSurface's honesty
// gates): upload picker / un-embeddable fallback / image stub all sit OVER the
// always-mounted DrawSurface, so switching input never unmounts (= never
// destroys) an in-progress sketch.
const PANE_OVERLAY: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: 24,
  background: 'var(--dir-bg)',
  borderRadius: 6,
  textAlign: 'center',
};

/** A segmented pill toggle — the app's standard 2-up control (2D/3D, Drawer/
 *  Shelf). Used for the destination + anonymity choices so they read as real
 *  toggles instead of a raw checkbox (Sebs 2026-06-14). */
function PillToggle({
  options,
  value,
  onChange,
}: {
  options: { v: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignSelf: 'flex-start',
        gap: 4,
        padding: 4,
        borderRadius: 999,
        border: '1px solid var(--dir-border)',
        background: 'var(--dir-raised)',
      }}
    >
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          style={{
            ...PILL,
            padding: '4px 14px',
            fontSize: 12,
            border: 'none',
            ...(value === o.v
              ? { background: 'var(--dir-text-primary)', color: 'var(--dir-bg)' }
              : { background: 'transparent' }),
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DrawPanel({
  onDone,
  onCancel,
  rightInset = 0,
  leftInset = 0,
  allowDrawer = false,
}: {
  /** Receives the markup for the ONE object this session made, plus the
   *  naming-stage meta: source strokes (the record keeps the hand — wedge
   *  contract), name + why. All optional — uploads carry no strokes.
   *  `sourceConfig` rides DeskPage's existing verbatim-config channel ("any
   *  future extras ride through untouched"): when present, the host stores it
   *  BYTE-FOR-BYTE as the row's render_config instead of snapshotting the
   *  pen. The tone-fill Done uses it to carry render_config.toneFills
   *  (addendum ch.2.1) — the panel builds the identical pen snapshot (same
   *  shared contexts, D-7 one pen) plus the tone record. */
  onDone: (
    svgMarkup: string,
    meta?: {
      strokes?: StrokePoint[][];
      name?: string | null;
      why?: string | null;
      sourceConfig?: Record<string, unknown> | null;
      /** Destination: the PUBLIC wall (default) or the maker's PRIVATE drawer. */
      dest?: 'public' | 'drawer';
      /** PRIVATE multi-save (Sebs 2026-06-18): ALSO save the placed doodle to the
       *  maker's Drawer and/or Shelf. Independent — tick either, both, or neither. */
      saveDrawer?: boolean;
      saveShelf?: boolean;
      /** Public-only: post under the @handle (false) or anonymously (true). */
      anon?: boolean;
    },
  ) => void;
  onCancel: () => void;
  /** px width of an open right controls panel (the desk's). The scrim reserves
   *  this on the right so the modal centers over the desk working area, not
   *  behind the panel. Default 0 — /canvas (no such panel) is unaffected. */
  rightInset?: number;
  /** px width of an open LEFT drawer panel — rightInset's mirror (UX-audit
   *  fix 4): the scrim reserves the drawer's width on the left so the modal
   *  centers over the VISIBLE desk. Same narrow-viewport clamp. Default 0. */
  leftInset?: number;
  /** Whether the "Public wall / My drawer" destination choice is offered. Only
   *  a PRIVATE context (your own desk/space) lets you stash to the drawer; the
   *  PUBLIC desk flow is public-only (Sebs 2026-06-14: "they can only add it to
   *  the public since they are in the public"), so the dest toggle is hidden and
   *  every doodle goes to the public wall. The anonymity choice still shows.
   *  Default false (the public board). */
  allowDrawer?: boolean;
}) {
  // Live mirror of DrawSurface's preview-stroke pool — setState is a stable
  // callback, so the mirror effect in DrawSurface doesn't re-fire on renders.
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  // Live mirror of the TONE-PATCH pool (the shade register's output) — same
  // stable-setState contract. Staged into render_config.toneFills at Done.
  const [tone, setTone] = useState<ToneFill[]>([]);
  // Inspection mirror (the __dd_decisionLog idiom): batteries + calibration
  // tooling read the live tone record without driving Done/Place — the
  // determinism check diffs JSON.stringify of this across scripted runs.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__dd_toneFills = tone;
  }, [tone]);
  // INK | SHADE — which tool the pointer wields while sketching (round 7).
  // Ink = strokes (the existing draw). Shade = the tone-fill brush: discrete
  // band-grey soft regions under the ink. A register, not a render mode —
  // Sketch|Style stays the canvas's render axis; Style pauses both tools.
  const [penRegister, setPenRegister] = useState<'ink' | 'shade' | 'erase'>('ink');
  // Erase sub-mode (GoodNotes Object/Pixel): object = whole stroke/patch, pixel = carve.
  const [eraseMode, setEraseMode] = useState<'object' | 'pixel'>('object');
  const [shadeTool, setShadeTool] = useState<ShadeToolState>(SHADE_TOOL_DEFAULT);
  // Input mode — same trio as the /canvas dock. Upload-svg hands the
  // sanitized markup straight to the desk's add boundary (normalizeSvgSize
  // sizes it there). upload-image is live now (autotrace via Quiver Edge fn): a
  // picked photo is traced + simplified to SVG markup, after which it IS an upload
  // exactly like a picked .svg — so isUploadInput drives every consumption site.
  const [input, setInput] = useState<PanelInput>('draw');
  const [upload, setUpload] = useState<{ name: string; markup: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Image trace is a network round-trip (~2–6s) — busy gates the picker + drives
  // honest "Tracing…" copy so the panel never looks frozen.
  const [uploadBusy, setUploadBusy] = useState(false);
  // SVG-UPLOAD SIMPLIFY MODE (Sebs 2026-06-16): how an uploaded .svg enters our
  // register — 'off' (as-is), 'filled' (clean filled line-art), 'line' (centerline
  // single-line). Changing it re-processes the SAME upload (no re-pick) by
  // re-applying applyUploadSimplify to rawSvgUpload (the raw prepared markup).
  // .svg-ONLY — traced images default to Clean and don't carry this toggle.
  const [simplifyMode, setSimplifyMode] = useState<UploadSimplifyMode>('filled');
  const [rawSvgUpload, setRawSvgUpload] = useState<string | null>(null);
  // The downscaled ORIGINAL photo (data-URL) from a traced IMAGE upload. Carried
  // onto the object's render_config so the hard-path 3D (Generate AI 3D) sends the
  // real PHOTO to TRELLIS — which makes a good mesh — instead of the flat doodle
  // render (which TRELLIS turns into a blob). null for .svg uploads / plain draw.
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  // HARD PATH (AI mesh) — reachable RIGHT HERE in the add flow (Sebs 2026-06-16:
  // "NO WAY TO GET THE TRELLIS HARD PATH"). Only image uploads carry a sourceImage,
  // and TRELLIS only makes a good mesh from a photo, so the "Generate AI 3D" button
  // shows for image uploads in the 3D view. The resulting GLB rides the modal's 3D
  // preview (Live3DMount hardMeshUrl) and onto the placed object via render_config.
  const [hardMeshUrl, setHardMeshUrl] = useState<string | null>(null);
  const [meshStatus, setMeshStatus] = useState<string | null>(null);
  // The 3D preview shows EITHER the instant local form ('local') OR the generated
  // AI mesh ('ai') — a real toggle so the user can switch BACK to the normal 3D
  // modes (Sebs 2026-06-16: "how do they switch back to the normal 3d modes").
  const [meshView, setMeshView] = useState<'local' | 'ai'>('local');
  const hardPathOn = isHardPathEnabled();
  // A new (or cleared) source photo invalidates any prior mesh + view.
  useEffect(() => {
    setHardMeshUrl(null);
    setMeshStatus(null);
    setMeshView('local');
  }, [sourceImage]);
  // A finished mesh auto-shows in AI view (the user just asked for it).
  useEffect(() => {
    if (hardMeshUrl) setMeshView('ai');
  }, [hardMeshUrl]);
  const generateAiMesh = useCallback(async () => {
    if (!sourceImage || meshStatus === 'working') return;
    setMeshStatus('working');
    try {
      const mesh = await runMesh(
        { imageUrl: sourceImage, provider: 'auto' },
        { onStatus: (j) => setMeshStatus(j.status) },
      );
      if (mesh?.glbUrl) {
        setHardMeshUrl(mesh.glbUrl);
        setMeshStatus('done');
      } else setMeshStatus('failed');
    } catch {
      setMeshStatus('failed');
    }
  }, [sourceImage, meshStatus]);
  // Either upload mode. A traced image becomes SVG markup, so once `upload` is
  // set the two modes are indistinguishable downstream (preview, backdrop,
  // staging, 3D-derive, size-cap) — one flag keeps them in lock-step.
  const isUploadInput = input === 'upload-svg' || input === 'upload-image';
  const isUploadImage = input === 'upload-image';
  // UPLOAD-REMOVAL STRANDING fix (smasher round 7): Remove with strokes/tone
  // present keeps the work and auto-switches the input register to Draw (the
  // strokes ARE a draw session — Done must work on them alone). This note is
  // the honest one-liner saying so; it takes over the caption slot (zero
  // layout shift) and clears itself after a few seconds.
  const [removeNote, setRemoveNote] = useState(false);
  const removeNoteTimer = useRef<number | null>(null);
  const showRemoveNote = () => {
    setRemoveNote(true);
    if (removeNoteTimer.current) window.clearTimeout(removeNoteTimer.current);
    removeNoteTimer.current = window.setTimeout(() => {
      setRemoveNote(false);
      removeNoteTimer.current = null;
    }, 5000);
  };
  // The note clears EARLY when the user moves on themselves (switches input,
  // stages a new file) — it must never describe a state that's gone.
  const clearRemoveNote = () => {
    if (removeNoteTimer.current) {
      window.clearTimeout(removeNoteTimer.current);
      removeNoteTimer.current = null;
    }
    setRemoveNote(false);
  };
  useEffect(
    () => () => {
      if (removeNoteTimer.current) window.clearTimeout(removeNoteTimer.current);
    },
    [],
  );
  // FILL-TOOL NOTE (rock F2, region-fill-spec §5.4): the honest-miss one-liner
  // ("no closed region here — raise Gap, or use Lasso") rides the same caption
  // slot as the remove-note — quiet, zero layout shift, self-clearing.
  const [fillNote, setFillNote] = useState<string | null>(null);
  const fillNoteTimer = useRef<number | null>(null);
  const showFillNote = useCallback((note: string) => {
    setFillNote(note);
    if (fillNoteTimer.current) window.clearTimeout(fillNoteTimer.current);
    fillNoteTimer.current = window.setTimeout(() => {
      setFillNote(null);
      fillNoteTimer.current = null;
    }, 4000);
  }, []);
  useEffect(
    () => () => {
      if (fillNoteTimer.current) window.clearTimeout(fillNoteTimer.current);
    },
    [],
  );

  // ── SHAPE ASSIST (Rock F3) ──────────────────────────────────────────────────
  // SEBS'S LAW: freehand is the DEFAULT. SNAP / STRAIGHTEN are action VERBS on
  // the LAST stroke when tapped — no mode, no auto-fire, no suggestion on
  // unprompted strokes. A user who never taps the pills never sees the feature.
  // DrawSurface owns the strokes + the apply; this panel owns the pills + the
  // chip (rendered by the pills, the SmartPickChip slot). The chip cycles the
  // ranked candidates INCLUDING 'original' (Sebs's drew-a-triangle-but-wants-
  // something-else case is first-class).
  const snapApiRef = useRef<ShapeSnapApi | null>(null);
  const handleSnapApi = useCallback((api: ShapeSnapApi) => {
    snapApiRef.current = api;
  }, []);

  // ── SNAP SWITCHER (Sebs 2026-06-15 — the ONE snap UI) ───────────────────────
  // No auto-offer on pen-up, no click-through cycle chip. The SNAP button fits
  // the last stroke, applies the best shape, and opens THIS switcher (recognized
  // ∪ 12 library ∪ Original) so the user can pick a different one. ✕ dismisses
  // (the applied shape stays; pick Original in the switcher to go back).
  const [override, setOverride] = useState<ShapeOverride | null>(null);
  const [switchAllOpen, setSwitchAllOpen] = useState(false);
  // SHAPE INSERT (Phase 2): the armed library shape (null = Freehand). Arming a
  // shape forces the ink register + clears any standing auto-detect offer.
  const [armedShape, setArmedShape] = useState<string | null>(null);
  const armShape = useCallback((kind: string | null) => {
    setArmedShape(kind);
    if (kind) {
      setPenRegister('ink');
      setOverride(null);
    }
  }, []);

  /** Log one shape-snap act into the unified decision log (training flywheel,
   *  spec §2.5/§8). */
  const logSnap = useCallback(
    (
      action: SnapAction,
      outcome: ShapeSnapOutcome,
      strokeId: string,
      result: ShapeFitResult,
      chosen: ShapeCandidate['kind'],
      margin: number,
    ) => {
      pushShapeSnapEntry({
        entryType: 'shape-snap',
        surface: 'shape-snap',
        action,
        outcome,
        strokeId,
        accepted: result.accepted,
        refusedReason: result.refusedReason,
        candidates: result.candidates.map((c) => ({
          kind: c.kind,
          normErr: c.normErr,
          score: c.score,
        })),
        chosen,
        margin,
      });
    },
    [],
  );

  /** Tap SNAP or STRAIGHTEN: fit the last stroke, apply the best candidate
   *  (or refuse honestly), raise the chip. Refusal honesty: below threshold →
   *  stroke UNTOUCHED, honest caption, full candidate table still logged. */
  const runSnap = useCallback(
    (action: SnapAction) => {
      const api = snapApiRef.current;
      if (!api) return;
      const last = api.lastStroke();
      if (!last) {
        showFillNote('nothing to snap — draw a stroke first');
        return;
      }
      const fit = api.fitLast(action);
      if (!fit) {
        showFillNote('that stroke is too small to snap');
        return;
      }
      const { strokeId, result } = fit;
      // Score margin between the top two real candidates (ambiguity signal).
      const real = result.candidates.filter((c) => c.kind !== 'original');
      const margin = real.length >= 2 ? real[0].score - real[1].score : real.length === 1 ? 1 : 0;
      if (!result.accepted) {
        // Honest no-snap — stroke untouched, full candidate table logged.
        logSnap(action, 'evaluate', strokeId, result, 'original', 0);
        showFillNote(
          action === 'snap'
            ? "didn't read as one clean shape — try Straighten"
            : "couldn't straighten that — it reads as a scribble",
        );
        return;
      }
      // Apply the best candidate immediately (that IS the snap, stays a stroke),
      // then OPEN the recognized+library switcher so the user can pick a
      // different shape. This is the ONE snap path now — it REPLACES both the
      // old click-through cycle chip AND the auto-offer-on-pen-up (Sebs
      // 2026-06-15: "snap is there, let a user click it… the clicking-through
      // chip — that was what this was supposed to replace").
      const best = result.candidates[0];
      api.applyToStroke(strokeId, best, last.points);
      logSnap(action, 'evaluate', strokeId, result, best.kind, margin);
      const switchSet = buildSwitchSet(result, last.points);
      const appliedIndex = Math.max(
        0,
        switchSet.findIndex((e) => e.source === 'recognized' && e.kind === best.kind),
      );
      setOverride({ strokeId, appliedKind: best.kind, switchSet, appliedIndex, originalPoints: last.points });
      setSwitchAllOpen(true);
    },
    [logSnap, showFillNote],
  );

  /** Apply ONE switch entry to the override's stroke. recognized → the fitted
   *  candidate; library → generate the primitive at the drawn stroke's bbox
   *  (spec §4.5); original → restore the drawn points. Keeps the receipt open so
   *  the user can keep switching. */
  const applyOverrideEntry = useCallback(
    (entry: SwitchEntry, index: number) => {
      const api = snapApiRef.current;
      if (!api || !override) return;
      if (entry.source === 'recognized' && entry.candidate) {
        api.applyToStroke(override.strokeId, entry.candidate, override.originalPoints);
      } else if (entry.source === 'library') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of override.originalPoints) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        const outline = generateShape(
          entry.kind as Parameters<typeof generateShape>[0],
          { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        );
        if (outline) {
          const cand: ShapeCandidate = {
            kind: 'polygon',
            points: outline as unknown as ShapeCandidate['points'],
            normErr: 0,
            score: 1,
            closed: true,
            label: entry.label,
            notes: `library:${entry.kind}`,
          };
          api.applyToStroke(override.strokeId, cand, override.originalPoints);
        }
      } else {
        const cand: ShapeCandidate = {
          kind: 'original',
          points: override.originalPoints as unknown as ShapeCandidate['points'],
          normErr: 0,
          score: 0,
          closed: false,
          label: 'Original',
        };
        api.applyToStroke(override.strokeId, cand, override.originalPoints);
      }
      logSnap('snap', 'cycle', override.strokeId, { accepted: true, candidates: [], refusedReason: undefined } as unknown as ShapeFitResult, entry.kind as ShapeCandidate['kind'], 0);
      setOverride({ ...override, appliedIndex: index, appliedKind: entry.kind });
      setSwitchAllOpen(false);
    },
    [override, logSnap],
  );

  /** Dismiss the snap switcher (keep whatever shape is applied). */
  const dismissSnapChip = useCallback(() => {
    setOverride(null);
    setSwitchAllOpen(false);
  }, []);

  // Gap scrub → slider sync (DrawSurface fires once per ladder step; the
  // scrubbed value persists in the shared tool state — spec D-RF3).
  const handleGapChange = useCallback((gap: number) => {
    setShadeTool((prev) => (prev.gap === gap ? prev : { ...prev, gap }));
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // UPLOAD PARITY (ROUND 6): the picked file prepared as a draw-over backdrop
  // — letterboxed into the same frame space the strokes live in. null with an
  // upload present = the file hides its size (no viewBox, no width/height);
  // the pane shows the honest non-draw-over fallback instead of pretending.
  const backdropFrame = useMemo(
    () => (upload ? prepareBackdrop(upload.markup) : null),
    [upload],
  );

  // ── THE PEN (shared state — D-7) ──────────────────────────────────────────
  // Same contexts the desk panel's SmartHachureChrome reads/writes. The popup
  // column is a second face of the ONE pen: change wobble here, the desk
  // panel's wobble slider holds the same value after close. The style
  // dropdown mirrors the chrome's preset-snap semantics exactly so picking a
  // style behaves identically from either surface.
  const { state: svgStyle, setState: setSvgStyle } = useF3SvgStyle();
  const { state: mods, set: setMod, replace: replaceMods } = useF3RoughModifiers();
  const declared = MODIFIER_SETS_BY_STYLE[svgStyle] ?? UNIVERSAL_MODIFIERS;
  const has = (k: string) => (declared as readonly string[]).includes(k);

  // ── SMART PICK (smart-system plan Phase C · SD-2/SD-3) ───────────────────
  // Fires ONCE at ingest: upload-SVG staging, and the drawn doodle's first
  // Done (entering the naming stage). The pick lands through the NORMAL
  // preset-snap path — identical to the user picking the style themselves —
  // then never touches a control again (I-1: dropdowns stay sacred). The
  // visible chip carries the rule receipts + a quiet undo that restores the
  // exact prior pen. Ambiguous input → no pick, no chip (smartPick logs the
  // abstention to window.__dd_inputPickLog).
  const [smartPick, setSmartPick] = useState<{
    result: SmartPickResult; // result.pick is non-null when stored here
    prior: { svgStyle: F3SvgStyle; mods: F3ModifiersState };
  } | null>(null);
  // CHIP HONESTY (smasher round 7): true while the chip fades out after the
  // pick was OVERRIDDEN — the user manually moved a style/control (their
  // choice is now the truth; a chip still claiming "smart picked X" would be
  // a lie, and its undo would discard the manual choice), or the picked
  // input was removed. Quiet fade → unmount; logged as 'overridden'.
  const [smartPickFading, setSmartPickFading] = useState(false);
  const smartPickFadeTimer = useRef<number | null>(null);
  // Once-per-session latch for the drawn path: Back-and-Done again is NOT a
  // new ingest — the pen must not re-move (SD-3 once-at-ingest).
  const drawPickEvaluatedRef = useRef(false);
  useEffect(
    () => () => {
      if (smartPickFadeTimer.current) window.clearTimeout(smartPickFadeTimer.current);
    },
    [],
  );

  /** The pick stopped being the active truth without an undo — fade the chip
   *  out and log the override. Idempotent (no chip / already fading = no-op),
   *  so every manual-change path can call it unconditionally. */
  function dismissSmartPick() {
    if (!smartPick || smartPickFading) return;
    logSmartPickOverridden(smartPick.result);
    setSmartPickFading(true);
    if (smartPickFadeTimer.current) window.clearTimeout(smartPickFadeTimer.current);
    smartPickFadeTimer.current = window.setTimeout(() => {
      setSmartPick(null);
      setSmartPickFading(false);
      smartPickFadeTimer.current = null;
    }, 260);
  }

  function applySmartPick(result: SmartPickResult) {
    // A new ingest supersedes any in-flight fade — settle it immediately so
    // the fresh chip never inherits a half-faded state.
    if (smartPickFadeTimer.current) {
      window.clearTimeout(smartPickFadeTimer.current);
      smartPickFadeTimer.current = null;
    }
    setSmartPickFading(false);
    const pick = result.pick;
    if (!pick) {
      // Abstained — clear any stale chip from a previous ingest so the
      // receipts never describe a different input than the one staged.
      setSmartPick(null);
      return;
    }
    const prior = { svgStyle, mods };
    // The style pick = the user's own style-change gesture: setSvgStyle +
    // preset snap (EXACTLY the onStyle handler below). Confident secondary
    // axes then land as ordinary dropdown moves on top of the preset.
    setSvgStyle(pick.axes.svgStyle);
    const snapped = applyStylePreset(mods, pick.axes.svgStyle);
    const next: F3ModifiersState = {
      ...snapped,
      ...(pick.axes.fillStyle !== undefined && { fillStyle: pick.axes.fillStyle }),
      ...(pick.axes.texture !== undefined && { texture: pick.axes.texture }),
      ...(pick.axes.penTip !== undefined && { penTip: pick.axes.penTip }),
      ...(pick.axes.multiStroke !== undefined && { multiStroke: pick.axes.multiStroke }),
      ...(pick.axes.sketchingStyle !== undefined && { sketchingStyle: pick.axes.sketchingStyle }),
    };
    (Object.keys(next) as (keyof typeof next)[]).forEach((k) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMod(k, (next as any)[k]);
    });
    setSmartPick({ result, prior });
  }

  function undoSmartPick() {
    // Undo only exists while the pick is UNTOUCHED — once a manual change
    // started the fade, reverting would discard that manual choice.
    if (!smartPick || smartPickFading) return;
    // Restore the EXACT prior pen (style + every modifier) — the snapshot
    // taken right before the pick applied. Logged as a rejection receipt.
    setSvgStyle(smartPick.prior.svgStyle);
    replaceMods(smartPick.prior.mods);
    logSmartPickUndo(smartPick.result);
    setSmartPick(null);
  }

  // ── SMART (on-demand) — one tap re-runs the existing smart-pick on the CURRENT
  // doodle and applies it (style + fillStyle + sliders), via the SAME applySmartPick
  // path as the ingest auto-pick (so the dropdowns reflect it + stay overridable —
  // I-1). User-initiated, so NO once-latch. Reported up so the host renders the
  // "Smart" pill in the style chrome (a sibling panel). ──────────────────────────
  const smartRunRef = useRef<() => 'applied' | 'abstained'>(() => 'abstained');
  smartRunRef.current = () => {
    let markup: string | null = null;
    if (isUploadInput && upload) markup = upload.markup;
    else if (strokes.length > 0 || tone.length > 0) markup = strokesToObjectMarkup(strokes, tone);
    if (!markup) return 'abstained';
    const result = smartPickFromMarkup(markup, input === 'draw' ? 'draw' : 'upload-svg');
    if (result?.pick) { applySmartPick(result); return 'applied'; }
    return 'abstained';
  };
  const stableSmartRun = useCallback((): 'applied' | 'abstained' => smartRunRef.current(), []);
  const smartHasContent = strokes.length > 0 || tone.length > 0 || (isUploadInput && !!upload);
  const smartActiveNow = smartPick !== null && !smartPickFading;

  // ── ESCAPE = ONE LAYER PER PRESS (safety pass, ROUND 6/7) ─────────────────
  // Bubble phase on window, so an open Dropdown popover (capture-phase
  // document listener that stops propagation) closes itself first — that IS
  // the topmost layer. Then, per press:
  //   · naming stage → BACK to compose (strokes intact), never popup-close;
  //   · compose with strokes → first press ARMS a visible confirm (footer
  //     note), second press within 3s closes — never silent destruction;
  //   · compose with nothing drawn → plain close.
  const [escapeArmed, setEscapeArmed] = useState(false);
  const escapeArmedRef = useRef(false);
  const escapeTimerRef = useRef<number | null>(null);
  const armEscape = useCallback(() => {
    escapeArmedRef.current = true;
    setEscapeArmed(true);
    if (escapeTimerRef.current) window.clearTimeout(escapeTimerRef.current);
    escapeTimerRef.current = window.setTimeout(() => {
      escapeArmedRef.current = false;
      setEscapeArmed(false);
    }, 3000);
  }, []);
  useEffect(
    () => () => {
      if (escapeTimerRef.current) window.clearTimeout(escapeTimerRef.current);
    },
    [],
  );

  // ── FOCUS: initial move-in + restore-to-opener ───────────────────────────
  // On open, focus the first control (the Draw pill — aria-modal demands
  // focus lands inside). On close, DeskPage unmounts us, so the cleanup
  // returns focus to whatever opened the panel (the Add-doodle pill), if it
  // still exists. theme.css's button:focus-visible rule draws the ring.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog) (getFocusables(dialog)[0] ?? dialog).focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  // ── FOCUS TRAP: Tab cycles inside the dialog, Shift+Tab reverses ─────────
  // Document-level so the trap still works if focus ever lands on the body
  // (e.g. after a pointer interaction with the non-focusable canvas svg) —
  // the next Tab pulls focus back to the first control instead of escaping
  // into the page behind the scrim.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = getFocusables(dialog);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !dialog.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const canDone =
    input === 'draw'
      ? strokes.length > 0 || tone.length > 0
      : isUploadInput
        ? upload !== null
        : false;

  // ── NAMING STAGE (the minting moment — Sebs, round 4) ────────────────────
  // Done no longer publishes: it stages the doodle and asks for its card info.
  // Back returns to drawing with strokes intact; Place publishes with meta.
  const [staged, setStaged] = useState<{
    markup: string;
    strokes?: StrokePoint[][];
    /** Size-guarded tone record (addendum ch.2.1) — publishes as
     *  render_config.toneFills via the sourceConfig channel at Place. */
    toneFills?: ToneFill[];
  } | null>(null);
  // DRAW | STYLE canvas mode (Sebs 2026-06-12): Draw = raw ink, keep
  // sketching, pen-up commits nothing. Style = sketching pauses, the drawing
  // renders styled and the pen controls restyle it live. Flip freely.
  const [composeMode, setComposeMode] = useState<'draw' | 'style'>('draw');
  // COMPOSE 2D / 3D (Sebs 2026-06-14: "STILL NO 3D TOGGLE HERE" — the Add-a-
  // doodle modal needs the same 2D/3D switch the desk panel has). 3D flips the
  // canvas pane to a LIVE 3D preview of the current drawing (Live3DMount reads
  // Canvas3DContext) and swaps the pen column for the full 3D controls — so you
  // tune the next doodle's 3D form right where you draw it. DrawSurface stays
  // mounted underneath (the gate idiom), so flipping back to 2D resumes the
  // exact sketch. Only meaningful with strokes to lift; reset to 2D otherwise. */
  const [composeView, setComposeView] = useState<'2d' | '3d'>('2d');
  // Strokes the 3D preview lifts: DRAWN strokes, OR strokes DERIVED from an
  // uploaded SVG (Sebs 2026-06-14: "when are we adding the 3d option for svg" —
  // upload→3D preview/tune in the same modal, the same derivation the desk flip
  // uses). Empty ⇒ no 3D toggle (nothing to lift).
  const composeStrokes = useMemo(() => {
    if (input === 'draw') return strokes.length > 0 ? capStrokes(strokes) : [];
    if (isUploadInput && upload) return svgMarkupToStrokes(upload.markup);
    return [];
  }, [input, strokes, upload]);
  const canComposeView3d = composeStrokes.length > 0;
  useEffect(() => {
    if (!canComposeView3d) setComposeView('2d');
  }, [canComposeView3d]);

  // SHAPE-ASSIST chip dismissal (spec §3): the chip's claim is about the prior
  // stroke, so it dismisses when a NEW stroke arrives, the register/compose
  // mode changes, or the input switches — the smart-pick chip's exact
  // lifecycle. A key gates the effect so it fires only on genuine change.
  const snapDismissKey = `${strokes.length}|${penRegister}|${composeMode}|${input}`;
  const prevSnapDismissKey = useRef(snapDismissKey);
  useEffect(() => {
    if (prevSnapDismissKey.current !== snapDismissKey) {
      prevSnapDismissKey.current = snapDismissKey;
      dismissSnapChip();
    }
  }, [snapDismissKey, dismissSnapChip]);

  const [stageName, setStageName] = useState('');
  const [stageWhy, setStageWhy] = useState('');
  // DESTINATION + anon (Sebs 2026-06-14) — replaces the per-doodle author field.
  // Where the doodle goes: PUBLIC wall (default) or your PRIVATE drawer; and when
  // public, post under your @handle or anonymously. Your ONE handle, shown or
  // hidden — never a different name per doodle.
  const [dest, setDest] = useState<'public' | 'drawer'>('public');
  // PRIVATE multi-save (Sebs 2026-06-18): on your OWN desk, ALSO save to Drawer
  // and/or Shelf — independent toggles (tick either, both, or neither). The button
  // always places on the desk; these add the extra copies.
  const [saveDrawer, setSaveDrawer] = useState(false);
  const [saveShelf, setSaveShelf] = useState(false);
  const [anon, setAnon] = useState(false);
  // SIZE-CAP HONESTY: set when Place measured the staged svg over the 64KB
  // server cap. The popup STAYS OPEN — nothing is lost. `exhausted` = the
  // shrink lever ran out of detail to smooth and it still doesn't fit.
  const [capNote, setCapNote] = useState<{ kb: number; exhausted?: boolean } | null>(null);
  // Receipt after a successful Shrink-to-fit (the staged markup was rebuilt
  // from decimated points; the live strokes stay full-fidelity — Back keeps
  // every point the user drew).
  const [shrunk, setShrunk] = useState(false);

  // The layered Escape handler (state machine documented at armEscape above).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (staged) {
        // Naming stage → Back. One layer per press; strokes + fields intact.
        setStaged(null);
        setCapNote(null);
        setShrunk(false);
        return;
      }
      if (strokes.length > 0 || tone.length > 0) {
        // Tone patches are unsaved work exactly like strokes — same guard.
        if (escapeArmedRef.current) onCancel();
        else armEscape();
        return;
      }
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [staged, strokes.length, tone.length, onCancel, armEscape]);

  // The minting preview's art, sized once per staging (230px long axis inside
  // the 280px well) — memoized so name/why keystrokes don't re-run DOMParser.
  const stagedPreviewMarkup = useMemo(
    () => (staged ? normalizeSvgSize(staged.markup, 230) : ''),
    [staged],
  );

  function handleDone() {
    setCapNote(null);
    setShrunk(false);
    // The snapped geometry already rides `strokes` (snap REPLACES the points,
    // stays a stroke) — strokesToObjectMarkup below picks it up with no extra
    // wiring. Dismiss the chip (logs 'keep' — the standing choice is final).
    dismissSnapChip();
    if (input === 'draw' && (strokes.length > 0 || tone.length > 0)) {
      // Tone patches ride the markup UNDER the ink (flat band-greys the
      // style pipeline converts to marks at band density) AND the staged
      // record as toneFills — svg stays regenerable from the record (ch.2.1).
      // A tone-only doodle is legal: the patch's own mask IS its region
      // (addendum ch.2.4 — no "close a shape first" rule).
      const markup = strokesToObjectMarkup(strokes, tone);
      // SMART PICK — drawn ingest: first Done (entering the naming stage) is
      // THE ingest moment for a drawn doodle. Latched per panel session so
      // Back-and-Done never re-fires (SD-3). Picks only when the gesture
      // rules are confident — sparse squiggles abstain silently.
      if (!drawPickEvaluatedRef.current) {
        drawPickEvaluatedRef.current = true;
        const evaluated = smartPickFromMarkup(markup, 'draw');
        if (evaluated) applySmartPick(evaluated);
      }
      setStaged({
        markup,
        strokes: strokes.length > 0 ? capStrokes(strokes) : undefined,
        toneFills: tone.length > 0 ? capToneFills(tone) : undefined,
      });
    } else if (isUploadInput && upload) {
      if (backdropFrame && (strokes.length > 0 || tone.length > 0)) {
        // DRAW-OVER MERGE (ROUND 6): backdrop + strokes (+ tone patches,
        // inverse-mapped the same way) become ONE object in one shared
        // coordinate space — the same composed markup the Style layer
        // previews live. The added strokes are NOT put in the record yet:
        // ObjectSurface's Re-draw Done rebuilds the svg from strokes ALONE
        // (strokesToObjectMarkup), which would silently DESTROY the upload
        // half of a merged object. Until Re-draw is backdrop-aware (queued,
        // ObjectSurface rock), merged objects take the honest "drawn before
        // re-editing existed" path instead of a data-loss one — toneFills
        // stay out of the merged record for the same reason (they'd survive,
        // but a strokeless record hides Re-draw anyway; consistency wins).
        setStaged({
          markup: composeBackdropAndStrokes(backdropFrame, strokes, {
            tight: true,
            toneFills: tone,
          }),
        });
      } else {
        setStaged({ markup: upload.markup });
      }
    }
  }

  function handlePlace() {
    if (!staged) return;
    // SIZE-CAP HONESTY: measure what actually gets published — DeskPage sends
    // normalizeSvgSize(markup, 180) to publish_to_open_desk, whose INSERT
    // rejects char_length(svg) > 64KB. Refuse with the honest note instead of
    // letting the row vanish server-side; the popup stays open, nothing lost.
    const finalLength = normalizeSvgSize(staged.markup, 180).length;
    if (finalLength > SVG_CHAR_CAP) {
      setCapNote({ kb: Math.ceil(finalLength / 1024) });
      return;
    }
    const hasTone = !!(staged.toneFills && staged.toneFills.length > 0);
    // DEST + ANON (Sebs 2026-06-14): you choose where this doodle goes — the
    // PUBLIC wall or your PRIVATE drawer — and, when public, whether to show your
    // @handle or post anonymously (your ONE handle, shown or hidden — never a
    // different per-doodle name; the old per-doodle "author" field is gone).
    // anon only applies to public; private = nobody else sees it. anon rides
    // render_config so the card can hide the handle.
    const anonFlag = dest === 'public' && anon;
    // PER-OBJECT 3D: if the doodle was composed in 3D, persist is3d so the desk
    // places it AS 3D on its own (Sebs 2026-06-16: "not placed as 3d when i have
    // it toggled 3d"). Rides the same render_config channel; an AI mesh (hardMeshUrl)
    // composed in 3D carries both, so it shows its mesh on the desk.
    const place3d = composeView === '3d' && canComposeView3d;
    // TONE rides render_config via the host's verbatim sourceConfig channel —
    // DeskPage stores it byte-for-byte as the row's render_config. The traced
    // PHOTO (sourceImage) rides the SAME channel so the hard-path 3D can send the
    // real photo to TRELLIS (Sebs 2026-06-16) — ObjectSurface.generateAiMesh reads
    // baseline.sourceImage. Also carrying svgStyle/modifiers means the placed image
    // object remembers it's Clean instead of falling back to a default pen.
    if (hasTone || anonFlag || sourceImage || place3d) {
      onDone(staged.markup, {
        name: stageName.trim() || null,
        why: stageWhy.trim() || null,
        dest,
        saveDrawer: allowDrawer && saveDrawer,
        saveShelf: allowDrawer && saveShelf,
        anon: anonFlag,
        sourceConfig: {
          svgStyle,
          modifiers: mods,
          ...(staged.strokes && staged.strokes.length > 0 ? { strokes: staged.strokes } : {}),
          ...(hasTone ? { toneFills: staged.toneFills } : {}),
          ...(anonFlag ? { anon: true } : {}),
          ...(sourceImage ? { sourceImage } : {}),
          ...(hardMeshUrl ? { hardMeshUrl } : {}),
          ...(place3d ? { is3d: true } : {}),
        },
      });
      return;
    }
    onDone(staged.markup, {
      strokes: staged.strokes,
      name: stageName.trim() || null,
      why: stageWhy.trim() || null,
      dest,
      saveDrawer: allowDrawer && saveDrawer,
      saveShelf: allowDrawer && saveShelf,
      anon: anonFlag,
    });
  }

  /** Shrink-to-fit — the REAL lever behind the size-cap note: halve point
   *  density (keeping endpoints, same decimation move capStrokes uses) until
   *  the rebuilt markup fits the cap. Works on a COPY — the live strokes keep
   *  full fidelity, so Back returns the drawing exactly as drawn. Pure-upload
   *  overflow has no stroke detail to smooth → the note says so instead. */
  function handleShrinkToFit() {
    if (strokes.length === 0) return;
    const build = (sts: Stroke[]) =>
      isUploadInput && backdropFrame
        ? composeBackdropAndStrokes(backdropFrame, sts, { tight: true, toneFills: tone })
        : strokesToObjectMarkup(sts, tone);
    let pts = strokes;
    for (let pass = 0; pass < 10; pass++) {
      const next = pts.map((st) =>
        st.points.length > 8
          ? { ...st, points: st.points.filter((_, i) => i % 2 === 0 || i === st.points.length - 1) }
          : st,
      );
      const flatBefore = pts.reduce((n, st) => n + st.points.length, 0);
      const flatAfter = next.reduce((n, st) => n + st.points.length, 0);
      pts = next;
      const markup = build(pts);
      if (normalizeSvgSize(markup, 180).length <= SVG_CHAR_CAP) {
        setStaged({
          markup,
          // The record's gesture follows the shrink (it IS the new source).
          // Merged draw-over objects record no strokes (see handleDone note).
          strokes: input === 'draw' ? capStrokes(pts) : undefined,
          // Tone patches keep full resolution — the shrink lever smooths
          // stroke detail; the tone record is small by construction.
          toneFills: input === 'draw' && tone.length > 0 ? capToneFills(tone) : undefined,
        });
        setCapNote(null);
        setShrunk(true);
        return;
      }
      if (flatAfter >= flatBefore) break; // no detail left to smooth
    }
    setCapNote((prev) => (prev ? { ...prev, exhausted: true } : prev));
  }

  /** Finish an upload once we have clean SVG markup (from either a traced image
   *  or a simplified .svg): set it as the upload + run the smart-pick ingest. The
   *  markup is already sanitized + in our register, so both paths converge here. */
  function acceptUploadMarkup(
    name: string,
    markup: string,
    kind: 'upload-svg' | 'upload-image' = 'upload-svg',
  ) {
    // MONOCHROME AT INGESTION (Sebs 2026-06-24): Desk Doodles is colourless ("value
    // from marks, never hue") — convert the upload's colour to luminance-grey HERE,
    // so it's monochrome everywhere downstream (desk · part editor · 3D), not patched
    // per view. Shapes keep their value (light head vs dark eyes) so they stay distinct.
    markup = monochromeSvgMarkup(markup);
    setUpload({ name, markup });
    setUploadError(null);
    clearRemoveNote();
    // ALL uploads default to CLEAN (Sebs 2026-06-16: "svg clean is our baseline,
    // that's what it defaults to"). The smart-pick was choosing styles with a
    // HACHURE/cross-hatch fill → faint cross-lines across line-art (the rose) and
    // a dense blob on traced photos. Clean renders the marks flat + clean (ink +
    // flat fill = the intended read); the user dials up rough/shading from the
    // chrome. (smartPickFromMarkup kept for a future opt-in chip, not auto-applied.)
    setSvgStyle('clean');
    // SNAP THE MODIFIERS to Clean's canonical preset too (Sebs 2026-06-16 — the
    // upload rendered DARK + OLIVE under a "Clean" label because setSvgStyle alone
    // leaves the MODIFIERS untouched: a prior Sketchy pick (texture:'light',
    // inkIntensity:0.85, fillStyle:'none') stuck, so Clean's NAME wore Sketchy's
    // settings → the 'light' texture grain + dimmed ink read muddy/blobby). Reset
    // from DEFAULT_MODIFIERS so leftover state can't bleed in — same move the chrome's
    // onStyle/onReset make, so an upload lands on the TRUE Clean look (flat fills,
    // texture:none, full ink) and the toggles ride from there.
    const cleanMods = applyStylePreset(DEFAULT_MODIFIERS, 'clean');
    (Object.keys(cleanMods) as (keyof typeof cleanMods)[]).forEach((k) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMod(k, (cleanMods as any)[k]);
    });
    // IMAGE-SPECIFIC FILL POLICY (Sebs decision 2026-06-21 — "smart per source"):
    // a traced PHOTO is a TONAL source, not line-art. Clean's fill grammar is
    // 'hachure' (the smart layer would render its regions as cross-lines → the
    // busy "dense blob on traced photos"). For image sources, swap the fill grammar
    // to 'solid' = the OPACITY-ONLY tonal fill (09-LOCKED-MODEL I-2 + 16-research-
    // solid-tonal-density: a region's source darkness renders as a flat solid at its
    // target L). So a photo reads as a clean POSTERIZED tonal image (flat greys per
    // region), never line hachure. Line-art SVG uploads keep Clean (already clean).
    // Localized + reversible; the register stays 'clean', only the mark grammar
    // changes — the user can re-pick any fillStyle from the chrome.
    if (kind === 'upload-image') setMod('fillStyle', 'solid');
    // LAND IN STYLE MODE (Sebs 2026-06-16: "the svg toggles don't work … when I
    // switch from one to another the svg stays"). An upload's first job is being
    // STYLED, not drawn-over. In Sketch mode the backdrop renders RAW (DrawSurface
    // bypasses SvgStyleTransform until styled=true), so the SVG-STYLE dropdown — and
    // the Clean default above — were invisible: the render never went through the
    // style engine. Landing in Style makes the upload render through SvgStyleTransform
    // immediately (Clean) and re-render live on every toggle. Flip to Sketch to draw over.
    setComposeMode('style');
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);

    // RASTER IMAGE → imageToSvg (Quiver Edge trace + simplifyToSketch + sanitize,
    // all inside the lib). Output is already clean line-art in OUR register, so it
    // feeds acceptUploadMarkup exactly like a prepared .svg from here on.
    if (isRasterImageFile(file)) {
      setUploadBusy(true);
      try {
        const traced = await imageToSvg(file);
        if (traced.ok) {
          setRawSvgUpload(null); // images don't carry the .svg-only Simplify toggle
          setSourceImage(traced.sourceImage ?? null); // keep the photo for hard-path 3D
          acceptUploadMarkup(file.name, traced.markup, 'upload-image');
        }
        else { setUpload(null); setRawSvgUpload(null); setSourceImage(null); setUploadError(traced.error); }
      } catch (err) {
        setUpload(null);
        setRawSvgUpload(null);
        setSourceImage(null);
        setUploadError(`Image tracing failed: ${(err as Error).message}`);
      } finally {
        setUploadBusy(false);
      }
      return;
    }

    // SVG → prepare (type check + <svg> extract + DOMPurify), then apply the
    // chosen SIMPLIFY MODE (off/filled/line) so the user picks how this upload
    // enters our register (Sebs 2026-06-16). The smart default matches the
    // source (filled art → 'filled', stroke-only → 'line'). We keep the RAW
    // prepared markup so changeSimplifyMode can re-process the SAME upload live
    // (no re-pick). applyUploadSimplify degrades safely (input unchanged if
    // unparseable), so a clean/simple file is untouched.
    const result = await prepareSvgUpload(file);
    if (result.ok) {
      setSourceImage(null); // a vector upload has no source photo for the hard path
      const mode = defaultSimplifyMode(result.markup);
      setSimplifyMode(mode);
      setRawSvgUpload(result.markup);
      const processed = applyUploadSimplify(result.markup, mode);
      acceptUploadMarkup(result.name, processed);
    } else {
      setUpload(null);
      setRawSvgUpload(null);
      setUploadError(result.error);
    }
  }

  /** Re-process the CURRENT .svg upload through a new simplify mode without a
   *  re-pick: re-apply applyUploadSimplify to the stored raw markup and push it
   *  through the SAME accept path so the preview updates live. No-op (just sets
   *  the mode) if no .svg is staged. */
  function changeSimplifyMode(m: UploadSimplifyMode) {
    setSimplifyMode(m);
    if (!rawSvgUpload) return;
    const processed = applyUploadSimplify(rawSvgUpload, m);
    acceptUploadMarkup(upload?.name ?? 'upload.svg', processed);
  }

  // The register row's one-line caption. The remove-note takes the slot over
  // briefly when it fires (honest one-liner, zero layout shift), then the
  // compose-state line returns. Computed once so the visible (possibly
  // ellipsized) text and its title tooltip always match.
  const captionText = removeNote
    ? 'upload removed — your strokes stay'
    : fillNote
      ? fillNote
      : composeMode === 'draw'
        ? penRegister === 'shade'
          ? shadeTool.tool === 'fill'
            ? shadeTool.erase
              ? 'erase fill — tap a region to lift its tone'
              : 'tap inside a region to fill it — hold, then drag sideways to scrub Gap'
            : shadeTool.tool === 'lasso'
              ? shadeTool.erase
                ? 'lasso erase — loop an area to lift its tone'
                : 'lasso — draw a loop, it closes on release and fills'
              : shadeTool.erase
                ? 'erasing tone — brush carves it back to paper'
                : `brushing ${COVERAGE_BANDS[shadeTool.band]?.name ?? 'mid'} tone — flat grey under your ink`
          : isUploadInput && backdropFrame
            ? 'raw ink over your upload — keep sketching'
            : 'raw ink — keep sketching'
        : isUploadInput && backdropFrame
          ? 'styled — the pen renders your upload live'
          : 'styled — play with the pen, flip back to keep drawing';

  // SNAP SWITCHER receipt — rendered INLINE right after the SNAP/STRAIGHTEN pills
  // (via DrawToolbar's snapSwitcher slot) so it sits AT the snap button, not
  // floating above the canvas (Sebs 2026-06-15). The labeled button toggles the
  // switcher (recognized ∪ 12 library ∪ Original); ✕ dismisses (pick Original to
  // revert). No auto-offer, no cycle chip.
  const snapSwitcherNode = override ? (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--dir-accent)' }} />
      <button
        style={{ ...PILL, fontFamily: IS, fontSize: 11, padding: '5px 12px', cursor: 'pointer', background: switchAllOpen ? 'var(--dir-text-primary)' : 'var(--dir-raised)', color: switchAllOpen ? 'var(--dir-bg)' : 'var(--dir-text-body)', border: '1px solid var(--dir-border)' }}
        onClick={() => setSwitchAllOpen((v) => !v)}
        title="Switch to another shape"
      >
        Snapped to {override.switchSet[override.appliedIndex]?.label ?? 'shape'} ▾
      </button>
      <button
        style={{ ...PILL, fontFamily: IS, fontSize: 11, padding: '5px 10px', cursor: 'pointer', background: 'var(--dir-raised)', color: 'var(--dir-text-body-soft)', border: '1px solid var(--dir-border)' }}
        onClick={() => setOverride(null)}
        title="Done"
      >
        ✕
      </button>
      {switchAllOpen && (
        <SwitchPopover override={override} onSwitchTo={applyOverrideEntry} onClose={() => setSwitchAllOpen(false)} />
      )}
    </div>
  ) : null;

  return (
    // Overlay scrim — click outside the panel closes ONLY when nothing is
    // drawn. With strokes present (or in the naming stage) the click is
    // NON-DESTRUCTIVE: it arms the same visible Esc-confirm hint instead of
    // eating the sketch (safety pass, ROUND 6/7).
    // Canvas3DProvider scopes an ISOLATED 3D context to this modal (nested under
    // any page-level provider): the compose 2D/3D toggle's preview + 3D controls
    // drive it, and tuning the next doodle's 3D never disturbs the desk's.
    <Canvas3DProvider>
    {/* Gates the AI-mesh material toggle in Canvas3DChrome — only after a mesh. */}
    <AiMeshActiveSync active={meshView === 'ai' && !!hardMeshUrl} />
    <style>{`@keyframes dd-spin { to { transform: rotate(360deg); } }`}</style>
    <div
      onClick={() => {
        if (staged) return; // staging = work definitely present — no-op
        if (strokes.length > 0 || tone.length > 0) {
          armEscape();
          return;
        }
        onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'color-mix(in srgb, var(--dir-text-primary) 28%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        // Reserve an open right controls panel's width so the modal centers
        // over the desk area, not behind it. Default 0 (e.g. on /canvas).
        // The inner min() CLAMPS the reservation on narrow viewports (the
        // ObjectSurface scrim pattern): unclamped 32+360px right padding
        // crushed the popup to a sliver once the viewport shrank. The mini-
        // desk row needs ~640px (320 canvas + 220 controls + gaps/padding),
        // so the popup keeps ≥640px and slides under the panel instead.
        paddingRight:
          rightInset > 0
            ? `max(32px, min(${32 + rightInset}px, calc(100vw - 672px)))`
            : 32,
        // The drawer's mirror (UX-audit fix 4) — same clamp so drawer +
        // controls open together can't crush the popup on narrow viewports.
        paddingLeft:
          leftInset > 0
            ? `max(32px, min(${32 + leftInset}px, calc(100vw - 672px)))`
            : 32,
      }}
    >
      {/* Centered panel — W1 raised surface, popover radius 16 (chromeStyles
          canon); nested DrawSurface frame keeps its 6px radius (concentric
          like dropdown option rows inside the 16px popover). Width sized for
          the mini-desk row: canvas + pen column side by side. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Draw a doodle"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--dir-raised)',
          border: '1px solid var(--dir-border)',
          position: 'relative',
          borderRadius: 16,
          boxShadow: RAISED_SHADOW,
          padding: 20,
          width: 'min(1180px, calc(100vw - 48px))',
          height: 'min(820px, calc(100vh - 48px))',
          maxHeight: 'calc(100vh - 48px)',
          // The DIALOG never scrolls (Sebs: only the right panel scrolls; the
          // canvas just fills the popup's fixed size). overflow hidden forces
          // the flex chain to clamp; the controls column scrolls internally.
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          fontFamily: IS,
          outline: 'none',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2 style={{ ...SECTION_LABEL }}>Add a doodle</h2>
          <span style={{ ...SECTION_LABEL, color: 'var(--dir-text-body-soft)' }}>
            {input === 'draw'
              ? strokes.length === 0 && tone.length === 0
                ? 'Each Done adds one object'
                : [
                    strokes.length > 0
                      ? `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`
                      : null,
                    tone.length > 0
                      ? `${tone.length} tone patch${tone.length === 1 ? '' : 'es'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
              : isUploadInput
                ? upload
                  ? `${upload.name}${
                      strokes.length > 0
                        ? ` · ${strokes.length} stroke${strokes.length === 1 ? '' : 's'} over`
                        : ''
                    }`
                  : 'Pick a file'
                : 'Coming with autotrace'}
          </span>
        </header>

        {/* Input mode row — same trio + sentence-case pill idiom as the
            /canvas dock (locked 2026-06-10). */}
        <div style={{ display: 'flex', gap: 8 }}>
          {(
            [
              ['draw', 'Draw'],
              ['upload-svg', 'Upload SVG'],
              ['upload-image', 'Upload image'],
            ] as [PanelInput, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                // Switching SOURCE clears the current upload so each mode opens at
                // its OWN picker (Sebs 2026-06-16: "when I switch between svg or
                // photo it stays what I had"). The old file of a different type must
                // not linger. Strokes/tone are the SKETCH — DrawSurface keeps them
                // mounted, so the draw-over work survives the source switch.
                if (key !== input) {
                  setUpload(null);
                  setRawSvgUpload(null);
                  setSourceImage(null);
                  setUploadError(null);
                  setSimplifyMode('filled');
                }
                setInput(key);
                clearRemoveNote();
                // Switching to Draw returns to Sketch mode (you draw before you
                // style); uploads flip themselves to Style on accept (above).
                if (key === 'draw') setComposeMode('draw');
              }}
              // Intentional PILL override — sentence-case 13/400 (dock idiom).
              style={{
                ...PILL,
                flex: 1,
                textAlign: 'center',
                textTransform: 'none',
                letterSpacing: 'normal',
                fontSize: 13,
                fontWeight: 400,
                padding: '8px 14px',
                background: input === key ? 'var(--dir-bg)' : 'transparent',
                color: 'var(--dir-text-primary)',
                borderColor: input === key ? 'var(--dir-accent)' : 'var(--dir-border)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* MINI-DESK ROW (Sebs 2026-06-11, ratified): canvas on the left, pen
            controls on the right — the same side-by-side grammar as the
            Sandbox surface and the big desk itself (canvas + right panel).
            flexWrap lets narrow viewports fall back to stacked. */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          <div
            style={{
              flex: '1 1 420px',
              minWidth: 320,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Hidden file input — dialog-level so both the picker overlay and
                the Replace pill reach it. display:none keeps it out of the
                focus trap (zero client rects). */}
            <input
              ref={fileRef}
              type="file"
              accept={isUploadImage ? 'image/png,image/jpeg,image/webp' : '.svg,image/svg+xml'}
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />

            {/* Sketch | Style — the canvas's own mode pills (the Pen|Desk
                grammar, one level down). UPLOAD PARITY (ROUND 6): the same
                pills work on uploads — Style renders the upload through the
                pen live. Hidden only behind the image stub. ROUND 7 adds the
                INK | SHADE register pair beside it: which tool the pointer
                wields while sketching (Style pauses both). */}
            {/* ROW LAYOUT (smasher round 7 caption-crush fix): pills never
                shrink; the caption is the row's ONE flexible item — single
                line, ellipsized, full text on hover via title. flexWrap only
                ever moves the upload cluster to a second line at narrow
                widths (the caption's flex-basis 0 keeps it on line one). */}
            {/* SHAPE INSERT quick-pick (Phase 2): arm a shape → drag on canvas to
                place it. Freehand (null) is the default. Only in the ink/draw flow. */}
            {composeMode === 'draw' && penRegister === 'ink' && (
              <div style={{ marginBottom: 8 }}>
                <ShapeStrip armedShape={armedShape} onArmShape={armShape} collapsed />
              </div>
            )}
            <DrawToolbar
              variant="panel"
              register={penRegister}
              onRegisterChange={setPenRegister}
              eraseMode={eraseMode}
              onEraseModeChange={setEraseMode}
              registerDisabled={composeMode === 'style'}
              registerDisabledTitle="Flip back to Sketch to keep working"
              shadeTool={shadeTool}
              onShadeToolChange={setShadeTool}
              showSnap={composeMode === 'draw'}
              snapEnabled={penRegister === 'ink' && strokes.length > 0}
              onSnapAction={runSnap}
              snapTitle={(act) =>
                penRegister === 'shade'
                  ? 'Snap works on ink — flip to Ink'
                  : strokes.length === 0
                    ? 'Draw a stroke first'
                    : act === 'snap'
                      ? 'Snap the last stroke to a clean shape'
                      : 'Crisp the last stroke’s edges (keeps your proportions)'
              }
              snapSwitcher={snapSwitcherNode}
              captionText={captionText}
              captionAlert={!!(removeNote || fillNote)}
              // Sketch | Style — the canvas's own render-axis pills. They stay
              // OWNED by this host (DrawToolbar never owns the render axis); the
              // leading slot just keeps them inline + adds the separator before
              // the register pair, byte-identical to the old row.
              leading={
                <>
                  {(['draw', 'style'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setComposeMode(m)}
                      aria-pressed={composeMode === m}
                      style={{
                        ...PILL,
                        padding: '6px 14px',
                        flexShrink: 0,
                        background: composeMode === m ? 'var(--dir-text-primary)' : 'var(--dir-bg)',
                        color: composeMode === m ? 'var(--dir-bg)' : 'var(--dir-text-primary)',
                      }}
                    >
                      {m === 'draw' ? 'Sketch' : 'Style'}
                    </button>
                  ))}
                  <span
                    aria-hidden
                    style={{ width: 1, alignSelf: 'stretch', background: 'var(--dir-border)', flexShrink: 0 }}
                  />
                </>
              }
              // Upload Replace / Remove cluster — only with a file picked.
              // The Simplify segmented toggle rides in front of it for .svg
              // uploads only (rawSvgUpload != null && upload-svg mode).
              trailing={
                isUploadInput && upload ? (
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {/* SVG SIMPLIFY toggle — .svg uploads only (not traced images,
                        which default to Clean). Re-processes the SAME upload live. */}
                    {input === 'upload-svg' && rawSvgUpload && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontFamily: IS, fontSize: 11, color: 'var(--dir-text-body-soft)' }}>
                          Simplify
                        </span>
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          {(
                            [
                              ['off', 'Off'],
                              ['filled', 'Filled'],
                              ['line', 'Line'],
                            ] as [UploadSimplifyMode, string][]
                          ).map(([m, label]) => (
                            <button
                              key={m}
                              onClick={() => changeSimplifyMode(m)}
                              aria-pressed={simplifyMode === m}
                              title={
                                m === 'off'
                                  ? 'Keep the SVG as-is'
                                  : m === 'filled'
                                    ? 'Clean filled line-art (keeps fills)'
                                    : 'Centerline single-line trace'
                              }
                              style={{
                                ...PILL,
                                fontFamily: IS,
                                fontSize: 11,
                                padding: '5px 10px',
                                cursor: 'pointer',
                                background: simplifyMode === m ? 'var(--dir-text-primary)' : 'var(--dir-bg)',
                                color: simplifyMode === m ? 'var(--dir-bg)' : 'var(--dir-text-primary)',
                                borderColor: simplifyMode === m ? 'var(--dir-accent)' : 'var(--dir-border)',
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </span>
                      </span>
                    )}
                    <button
                      onClick={() => fileRef.current?.click()}
                      style={{ ...PILL, padding: '5px 12px', background: 'var(--dir-bg)' }}
                    >
                      Replace file
                    </button>
                    <button
                      onClick={() => {
                        // UPLOAD-REMOVAL STRANDING fix: strokes/tone drawn over
                        // the file are KEPT (DrawSurface never unmounts) — the
                        // input register auto-switches to Draw so Done works on
                        // them alone, with the honest one-line note. The chip's
                        // pick described the removed file — no longer the
                        // active truth; quiet fade, logged as overridden.
                        const keepWork = strokes.length > 0 || tone.length > 0;
                        setUpload(null);
                        setRawSvgUpload(null);
                        setSourceImage(null);
                        setUploadError(null);
                        dismissSmartPick();
                        if (keepWork) {
                          setInput('draw');
                          showRemoveNote();
                        }
                      }}
                      title="Remove the file — your strokes stay"
                      style={{
                        ...PILL,
                        padding: '5px 12px',
                        background: 'transparent',
                        color: 'var(--dir-text-body-soft)',
                      }}
                    >
                      Remove
                    </button>
                  </span>
                ) : null
              }
            />

            {/* THE PANE — DrawSurface stays mounted across ALL input modes
                (switching input never destroys a sketch); upload states sit
                OVER it as opaque covers (the gate idiom). With a file picked,
                the upload letterboxes in as a draw-over backdrop and the
                preview FILLS THE PANE like draw mode (ROUND 6 spec d). */}
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <DrawSurface
                mode="svg"
                input="draw"
                hideActions
                fill
                styled={composeMode === 'style'}
                backdrop={isUploadInput ? backdropFrame : undefined}
                onStrokesChange={setStrokes}
                shade={{
                  // The Erase register rides the tone-brush gesture as a band-0
                  // lifter (carves tone) — and eraseStrokes below makes the SAME
                  // drag also rub out ink. So one Erase tool wipes anything drawn.
                  active: composeMode === 'draw' && (penRegister === 'shade' || penRegister === 'erase'),
                  tool: penRegister === 'erase' ? 'brush' : shadeTool.tool,
                  band: penRegister === 'erase' ? 0 : shadeTool.band,
                  radius: shadeTool.radius,
                  erase: penRegister === 'erase' ? true : shadeTool.erase,
                  gap: shadeTool.gap,
                  fullFill: shadeTool.fullFill,
                }}
                eraseStrokes={composeMode === 'draw' && penRegister === 'erase'}
                eraseMode={eraseMode}
                onToneFillsChange={setTone}
                onGapChange={handleGapChange}
                onFillNote={showFillNote}
                onSnapApi={handleSnapApi}
                onSelectionChange={(id) => { if (id === null) setOverride(null); }}
                armedShape={armedShape}
                onShapeInserted={() => { setOverride(null); setArmedShape(null); }}
              />

              {/* Upload picker — no file yet. */}
              {isUploadInput && !upload && (
                <div style={PANE_OVERLAY}>
                  <p style={{ fontFamily: IS, fontSize: 13, color: 'var(--dir-text-body-soft)', margin: 0, maxWidth: 280, textAlign: 'center' }}>
                    {isUploadImage
                      ? 'Your photo becomes a clean sketch in the Desk Doodles style — then style it with the pen, draw over it, flip it to 3D.'
                      : 'The file becomes one desk object — style it with the pen, draw over it, size handled automatically.'}
                  </p>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploadBusy}
                    // Heavier border = empty-state affordance (canvas dock precedent).
                    style={{
                      ...PILL,
                      padding: '10px 22px',
                      background: 'var(--dir-bg)',
                      opacity: uploadBusy ? 0.6 : 1,
                      cursor: uploadBusy ? 'wait' : 'pointer',
                      border: '1px solid var(--dir-text-primary)',
                    }}
                  >
                    {uploadBusy
                      ? 'Tracing your image…'
                      : isUploadImage
                        ? 'Pick a photo (PNG / JPG)'
                        : 'Pick an .svg file'}
                  </button>
                  {uploadError && (
                    <p style={{ fontFamily: IS, fontSize: 12, color: 'var(--dir-accent)', margin: 0 }}>
                      {uploadError}
                    </p>
                  )}
                </div>
              )}

              {/* Un-embeddable upload — the file carries no size info (no
                  viewBox, no width/height), so frame-space draw-over can't
                  letterbox it honestly. Thumbnail preview + plain placement
                  still work; no fake draw-over. */}
              {isUploadInput && upload && !backdropFrame && (
                <div style={PANE_OVERLAY}>
                  <div
                    style={{ width: 180, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    dangerouslySetInnerHTML={{
                      // normalizeSvgSize derives sizing where possible; markup is
                      // DOMPurify-sanitized upstream by prepareSvgUpload.
                      __html: normalizeSvgSize(upload.markup, 180),
                    }}
                  />
                  <p style={{ fontFamily: IS, fontSize: 12, color: 'var(--dir-text-body-soft)', margin: 0, maxWidth: 360, lineHeight: 1.5 }}>
                    This file hides its size, so drawing over it is off — it
                    still places on the desk just fine.
                  </p>
                </div>
              )}

              {/* (Image-upload stub removed 2026-06-16 — image→object is live via
                  the Quiver Edge trace; upload-image now shares the picker +
                  backdrop-preview chrome above via isUploadInput.) */}

              {/* LIVE 3D PREVIEW — flipped via the pen column's 2D/3D toggle.
                  Sits OVER the still-mounted DrawSurface (gate idiom), so the
                  sketch is never lost; flip back to 2D to keep drawing. Driven
                  by Canvas3DContext (Live3DMount) so the 3D controls beside it
                  tune THIS preview live. Transparent + interactive (spin it). */}
              {composeView === '3d' && canComposeView3d && (
                <div
                  style={{
                    ...PANE_OVERLAY,
                    padding: 0,
                    backgroundColor: 'var(--dir-bg)',
                    backgroundImage: `${PAPER_GRAIN}, ${WARM_POOL}`,
                    overflow: 'hidden',
                  }}
                >
                  <Live3DMount
                    strokes={composeStrokes as never}
                    hardMeshUrl={meshView === 'ai' ? (hardMeshUrl ?? undefined) : undefined}
                    transparent
                    interactive
                    showChips={false}
                  />
                  {/* LOADING — TRELLIS takes ~30–90s; without this the click looked
                      dead (Sebs 2026-06-16 "i click it and nothing happens"). */}
                  {meshStatus === 'working' && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        background: 'color-mix(in srgb, var(--dir-bg) 78%, transparent)',
                        pointerEvents: 'none',
                      }}
                    >
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          border: '3px solid var(--dir-border)',
                          borderTopColor: 'var(--dir-text-primary)',
                          animation: 'dd-spin 0.8s linear infinite',
                        }}
                      />
                      <span style={{ fontFamily: IS, fontSize: 12, color: 'var(--dir-text-body)' }}>
                        Generating AI 3D… (~30–90s)
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* PEN CONTROLS COLUMN — the desk panel's pen, second face. Style
              dropdown + the three core feel sliders (same specs + gating as
              SmartHachureChrome, writing to the SAME contexts — one pen).
              Border-left + paddingLeft mirrors the Sandbox column grammar. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flex: '1 1 240px',
              minWidth: 220,
              minHeight: 0,
              borderLeft: '1px solid var(--dir-border)',
              paddingLeft: 18,
              alignSelf: 'stretch',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span style={SECTION_LABEL}>{composeView === '3d' ? '3D controls' : 'Pen'}</span>
              {canComposeView3d ? (
                <div
                  role="tablist"
                  aria-label="Edit in 2D or 3D"
                  style={{
                    display: 'inline-flex',
                    gap: 4,
                    padding: 3,
                    borderRadius: 999,
                    border: '1px solid var(--dir-border)',
                    background: 'var(--dir-bg)',
                  }}
                >
                  {(['2d', '3d'] as const).map((v) => (
                    <button
                      key={v}
                      role="tab"
                      aria-selected={composeView === v}
                      onClick={() => setComposeView(v)}
                      style={{
                        ...PILL,
                        padding: '3px 11px',
                        fontSize: 10,
                        border: 'none',
                        ...(composeView === v
                          ? { background: 'var(--dir-text-primary)', color: 'var(--dir-bg)' }
                          : { background: 'transparent' }),
                      }}
                    >
                      {v.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : (
                <span
                  style={{
                    fontFamily: IS,
                    fontSize: 10,
                    fontStyle: 'italic',
                    color: 'var(--dir-text-body-soft)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  one pen — shared with the desk panel
                </span>
              )}
            </div>

            {composeView === '3d' ? (
              // 3D CONTROLS — the SAME Canvas3DChrome the desk panel + edit modal
              // use, driving this modal's own Canvas3DContext (the preview reads
              // it live). Geometry mode + 3D style + material + property dials.
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
                {/* TRELLIS HARD PATH — reachable right here in the add/upload 3D
                    flow (Sebs 2026-06-16). Image uploads only (sourceImage): TRELLIS
                    needs a real photo to make a good mesh. Sends the ORIGINAL photo,
                    swaps the preview to the returned GLB, ~30–90s + costs a gen. */}
                {hardPathOn && sourceImage && (
                  <div style={{ marginBottom: 12 }}>
                    {/* LOCAL 3D ⇄ AI MESH — switch BACK to the normal local 3D modes
                        anytime (Sebs 2026-06-16 "how do they switch back"). Local =
                        the instant doodle form (geometry/material below). AI mesh =
                        the TRELLIS GLB (its own material toggle appears once ready). */}
                    <div
                      role="tablist"
                      aria-label="Local 3D or AI mesh"
                      style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 999, border: '1px solid var(--dir-border)', background: 'var(--dir-bg)', marginBottom: 8 }}
                    >
                      {(['local', 'ai'] as const).map((v) => (
                        <button
                          key={v}
                          role="tab"
                          aria-selected={meshView === v}
                          onClick={() => setMeshView(v)}
                          style={{
                            ...PILL,
                            flex: 1,
                            justifyContent: 'center',
                            padding: '5px 10px',
                            fontSize: 11,
                            border: 'none',
                            ...(meshView === v
                              ? { background: 'var(--dir-text-primary)', color: 'var(--dir-bg)' }
                              : { background: 'transparent' }),
                          }}
                        >
                          {v === 'local' ? 'Local 3D' : 'AI mesh'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* AI mesh selected → its OWN controls; otherwise the local-3D chrome.
                    The local Native/Hatch/Matte-Clay controls don't apply to a GLB. */}
                {hardPathOn && sourceImage && meshView === 'ai' ? (
                  <AiMeshControls hardMeshUrl={hardMeshUrl} meshStatus={meshStatus} onGenerate={generateAiMesh} />
                ) : (
                  <Canvas3DChrome />
                )}
              </div>
            ) : (
              <>
            {/* SMART PICK receipt — visible right where the pen lives, so the
                "why did the controls just move" question is answered before
                it's asked. Undo restores the exact prior pen. */}
            {smartPick?.result.pick && (
              <SmartPickChip
                pick={smartPick.result.pick}
                onUndo={undoSmartPick}
                fading={smartPickFading}
              />
            )}

            {/* FULL per-style control set (feedback_never_trim_control_sets —
                Sebs hit "missing toggles" 3x before this stuck): the SAME
                generic spec-table renderer the Edit/Sandbox popups use. The
                column scrolls internally; dropdown menus stay short so there
                is never scroll-inside-scroll. */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
              <SurfaceControls
                svgStyle={svgStyle}
                mods={mods}
                onSmart={smartHasContent ? stableSmartRun : undefined}
                smartActive={smartActiveNow}
                onStyle={(nextStyle) => {
                  // Manual style change = the pick (if any) is no longer the
                  // active truth — chip fades, override logged (chip honesty).
                  dismissSmartPick();
                  setSvgStyle(nextStyle);
                  // Auto-snap modifiers to the new style's preset — EXACTLY the
                  // desk chrome's onChange, so the pen behaves identically no
                  // matter which surface picks the style.
                  const next = applyStylePreset(mods, nextStyle);
                  (Object.keys(next) as (keyof typeof next)[]).forEach((k) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    setMod(k, (next as any)[k]);
                  });
                }}
                onMod={(key, value) => {
                  // Same honesty rule for every slider/dropdown move. The
                  // pick's own writes go through setMod DIRECTLY (applySmartPick),
                  // so this only ever fires on real user gestures.
                  dismissSmartPick();
                  setMod(key, value);
                }}
                onReset={() => {
                  dismissSmartPick();
                  const next = applyStylePreset(DEFAULT_MODIFIERS, svgStyle);
                  (Object.keys(next) as (keyof typeof next)[]).forEach((k) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    setMod(k, (next as any)[k]);
                  });
                }}
              />
            </div>
              </>
            )}
          </div>
        </div>

        {/* NAMING STAGE — covers the compose UI when staged (the minting
            moment): art on the warm-paper well, name in the maker's register
            (Fraunces + wonk, mirrors ObjectCard), why in Fraunces italic.
            Back keeps the strokes; Place publishes with the meta. */}
        {staged && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 5,
              background: 'var(--dir-raised)',
              borderRadius: 16,
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {/* The naming stage carries NO 2D/3D toggle (Sebs 2026-06-14: "this
                here shouldn't have the 2D 3D toggle") — 3D preview + tuning lives
                on the compose/draw stage; this stage is just name + place. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={SECTION_LABEL}>Name your doodle</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                style={{
                  width: 280,
                  height: 280,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--dir-border)',
                  borderRadius: 10,
                  backgroundColor: 'var(--dir-bg)',
                  backgroundImage: `${PAPER_GRAIN}, ${WARM_POOL}`,
                  overflow: 'hidden',
                }}
              >
                {/* STYLED MINTING PREVIEW (ROUND 6): the staged art renders
                    through the SAME nested-provider + SvgStyleTransform scope the
                    desk uses, synced to the CURRENT pen — the doodle the user
                    actually styled, never raw 3px hairlines. No 2D/3D toggle here
                    (it lives on the compose/draw stage — Sebs 2026-06-14). */}
                <F3SvgStyleProvider>
                  <F3RoughModifiersProvider>
                    <StagedRenderScope svgStyle={svgStyle} mods={mods}>
                      <SvgStyleTransform>
                        <div aria-hidden dangerouslySetInnerHTML={{ __html: stagedPreviewMarkup }} />
                      </SvgStyleTransform>
                    </StagedRenderScope>
                  </F3RoughModifiersProvider>
                </F3SvgStyleProvider>
              </div>
            </div>

            {/* SIZE-CAP HONESTY (ROUND 6): Place measured the staged svg over
                the 64KB server cap. Say so, keep the popup open, and offer the
                real lever — Shrink to fit smooths point density; the live
                strokes keep full fidelity so Back loses nothing. */}
            {capNote && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontFamily: IS,
                    fontSize: 12,
                    color: 'var(--dir-accent)',
                    lineHeight: 1.5,
                    textAlign: 'center',
                    maxWidth: 520,
                  }}
                >
                  {capNote.exhausted
                    ? `Still too detailed after smoothing — the desk caps doodles at 64KB (this one is ~${capNote.kb}KB). Go Back and try fewer strokes${isUploadInput ? ' or a simpler file' : ''}.`
                    : strokes.length > 0
                      ? `Too detailed to save — the desk caps doodles at 64KB (this one is ~${capNote.kb}KB). Nothing is lost: shrink it to fit, or go Back and edit.`
                      : `Too detailed to save — the desk caps doodles at 64KB (this file is ~${capNote.kb}KB). Nothing is lost: go Back and try a simpler file.`}
                </span>
                {strokes.length > 0 && !capNote.exhausted && (
                  <button
                    onClick={handleShrinkToFit}
                    title="Smooth the finest point detail until the doodle fits"
                    style={{ ...PILL, padding: '6px 14px', background: 'var(--dir-bg)', flexShrink: 0 }}
                  >
                    Shrink to fit
                  </button>
                )}
              </div>
            )}
            {shrunk && !capNote && (
              <span
                role="status"
                style={{
                  fontFamily: IS,
                  fontSize: 11,
                  fontStyle: 'italic',
                  color: 'var(--dir-text-body-soft)',
                  textAlign: 'center',
                }}
              >
                smoothed the finest detail to fit the desk&rsquo;s 64KB cap
              </span>
            )}
            {/* SMART PICK receipt in the naming stage too — the drawn-path
                pick fires at Done, and this overlay covers the pen column,
                so the chip must be visible HERE for that ingest. */}
            {smartPick?.result.pick && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <SmartPickChip
                  pick={smartPick.result.pick}
                  onUndo={undoSmartPick}
                  fading={smartPickFading}
                />
              </div>
            )}
            <div style={{ maxWidth: 460, width: '100%', alignSelf: 'center', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                autoFocus
                value={stageName}
                onChange={(e) => setStageName(e.target.value)}
                placeholder="Name your doodle"
                aria-label="Doodle name"
                maxLength={60}
                style={{
                  fontFamily: ISe,
                  fontVariationSettings: '"SOFT" 60, "WONK" 1',
                  fontSize: 20,
                  letterSpacing: '-0.01em',
                  color: 'var(--dir-text-primary)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--dir-border)',
                  outline: 'none',
                  padding: '2px 0',
                }}
              />
              <input
                value={stageWhy}
                onChange={(e) => setStageWhy(e.target.value)}
                placeholder={'Why\u2019s this on your desk?'}
                aria-label="Why this doodle"
                maxLength={140}
                style={{
                  fontFamily: ISe,
                  fontSize: 14,
                  fontStyle: 'italic',
                  color: 'var(--dir-text-body)',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                }}
              />
              {/* DESTINATION + VISIBILITY (Sebs 2026-06-14, replaces the per-
                  doodle author). The dest toggle (public wall / my drawer) only
                  shows in a PRIVATE context — the public desk flow is public-only
                  ("they can only add it to the public since they are in the
                  public"), so there it's hidden and dest stays 'public'.
                  Anonymity is its own segmented toggle (matches the app's other
                  toggles), shown whenever the destination is public. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
                {allowDrawer && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={SECTION_LABEL}>Also save to</span>
                    {/* On a desk you OWN the button always PLACES the doodle on
                        THIS desk; these are INDEPENDENT extra saves — tick Drawer,
                        Shelf, both, or neither (Sebs 2026-06-18). Multi-select, not
                        a one-or-the-other toggle. */}
                    <div
                      style={{
                        display: 'inline-flex',
                        alignSelf: 'flex-start',
                        gap: 4,
                        padding: 4,
                        borderRadius: 999,
                        border: '1px solid var(--dir-border)',
                        background: 'var(--dir-raised)',
                      }}
                    >
                      <button
                        type="button"
                        aria-pressed={saveDrawer}
                        onClick={() => setSaveDrawer((v) => !v)}
                        style={{
                          ...PILL,
                          padding: '4px 14px',
                          fontSize: 12,
                          border: 'none',
                          ...(saveDrawer
                            ? { background: 'var(--dir-text-primary)', color: 'var(--dir-bg)' }
                            : { background: 'transparent' }),
                        }}
                      >
                        Drawer
                      </button>
                      <button
                        type="button"
                        aria-pressed={saveShelf}
                        onClick={() => setSaveShelf((v) => !v)}
                        style={{
                          ...PILL,
                          padding: '4px 14px',
                          fontSize: 12,
                          border: 'none',
                          ...(saveShelf
                            ? { background: 'var(--dir-text-primary)', color: 'var(--dir-bg)' }
                            : { background: 'transparent' }),
                        }}
                      >
                        Shelf
                      </button>
                    </div>
                  </div>
                )}
                {dest === 'public' && !allowDrawer && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={SECTION_LABEL}>Your name</span>
                    <PillToggle
                      options={[
                        { v: 'show', label: 'Show @handle' },
                        { v: 'anon', label: 'Anonymous' },
                      ]}
                      value={anon ? 'anon' : 'show'}
                      onChange={(v) => setAnon(v === 'anon')}
                    />
                  </div>
                )}
              </div>
            </div>
            <footer style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button
                onClick={() => {
                  // Back = one layer down, strokes + fields intact (Escape
                  // lands here too). Cap state clears — re-staging re-measures.
                  setStaged(null);
                  setCapNote(null);
                  setShrunk(false);
                }}
                style={PILL}
              >
                Back
              </button>
              <button onClick={handlePlace} style={CTA}>
                {allowDrawer ? 'Place on desk' : dest === 'drawer' ? 'Save to my drawer' : 'Place on desk'}
              </button>
            </footer>
          </div>
        )}

        <footer style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
          {/* The armed Esc-confirm hint — visible feedback for the guarded
              close paths (Esc with strokes, scrim-click with strokes).
              Disarms itself after 3s; a second Esc while armed closes. */}
          {escapeArmed && (
            <span
              role="status"
              style={{
                fontFamily: IS,
                fontSize: 11,
                fontStyle: 'italic',
                color: 'var(--dir-accent)',
                marginRight: 'auto',
              }}
            >
              your sketch is unsaved — press Esc again (or Cancel) to discard it
            </span>
          )}
          <button onClick={onCancel} style={PILL}>
            Cancel
          </button>
          <button
            onClick={handleDone}
            disabled={!canDone}
            title={
              canDone
                ? 'Add this doodle to the desk'
                : input === 'draw'
                  ? 'Draw or shade something first'
                  : isUploadImage
                    ? 'Pick a photo first'
                    : 'Pick a file first'
            }
            style={{
              ...CTA,
              opacity: canDone ? 1 : 0.5,
              cursor: canDone ? 'pointer' : 'not-allowed',
            }}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
    </Canvas3DProvider>
  );
}
