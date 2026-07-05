import type { WebGLRenderer } from 'three';

// ─── WebGL context-loss recovery (Sebs 2026-06-19) ──────────────────────────
// By DEFAULT the browser does NOT restore a lost WebGL context — a GPU reset, a
// tab throttle, too many live contexts, or Make's cold-load preview can drop it
// and the canvas just goes BLACK until the component remounts. Calling
// preventDefault() on the 'webglcontextlost' event opts into restoration, after
// which the browser fires 'webglcontextrestored' and R3F's render loop repaints.
//
// This complements the auto-retry `Canvas3DBoundary` (DeskObject3DMount): that
// boundary catches a HARD throw and remounts; this handles the SOFT loss that
// doesn't throw (the silent black-canvas case the boundary never sees).

/** Attach the lost/restored listeners to a renderer's canvas. Call once from a
 *  Canvas `onCreated`. Idempotent-ish (a remounted Canvas gets a fresh element,
 *  so duplicate listeners don't accumulate on the same node). */
export function attachContextLossHandlers(gl: WebGLRenderer): void {
  const canvas = gl.domElement;
  canvas.addEventListener(
    'webglcontextlost',
    (e) => {
      // Without this the context is gone for good → permanent black canvas.
      e.preventDefault();
    },
    false,
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      // The default frameloop ('always') repaints on the next frame; resetState
      // clears any stale GL bindings first so the first restored frame is clean.
      try {
        gl.resetState?.();
      } catch {
        /* older three without resetState — the next frame still repaints */
      }
    },
    false,
  );
}
