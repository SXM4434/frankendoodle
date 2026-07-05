// ─── deskCraft — ONE warm-paper craft material, shared by desk + card ────────
// Per the verify-sweep finding (06-11): the desk surface and the ObjectCard art
// well each hand-rolled their own paper grain (0.8 vs 0.85) + their own warm
// light-pool radial, so the two surfaces read as DIFFERENT materials. This
// module is the single source for the warm-paper craft layer so the desk an
// object SITS on and the card the same object is FRAMED in read as the SAME
// stock under the same lamp. Restraint over realism (feedback_no_cheap_polish):
// a whisper of grain + a soft warm pool, never wood/cork.

// One paper grain, TWO frequency layers in one tiled data-URI — because paper
// tooth lives at two scales: a fine speckle you see up close, and a coarser
// mottle that keeps the surface reading as paper when zoomed out (fine noise
// alone spatially averages to flat at desk scale — Sebs 2026-06-11 "harder to
// see zoomed out"). Layer 1: f0.8 oct2 op0.22 (the close-up tooth, picked
// 2026-06-11 /tmp/grain-ab2.html — original 0.05 was imperceptible). Layer 2:
// f0.35 oct3 op0.14 (the zoom-out presence, picked /tmp/grain-ab3.html — G3;
// stronger went blotchy). Still greyscale + whisper-quiet, never wood/cork.
export const PAPER_GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='280'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Cfilter id='c'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.35' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)' opacity='0.22'/%3E%3Crect width='100%25' height='100%25' filter='url(%23c)' opacity='0.14'/%3E%3C/svg%3E\")";

// One warm light-pool radial — a soft pool of lamp-warmth pooling toward the
// working center. Use as a `backgroundImage` gradient layer, composed over the
// grain. Same ellipse + warm tint on both surfaces.
export const WARM_POOL =
  'radial-gradient(ellipse 72% 66% at 50% 42%, rgba(255,246,229,0.5) 0%, rgba(255,246,229,0) 63%)';

// Objects sit, not float — layered, hue-tinted (warm, not pure black) shadows:
// a tight contact shadow + a softer ambient one, light from above-left
// (Comeau). Subtle enough on loose ink that it reads as "lifted off the paper,"
// never embossed. Applied as a CSS `filter`.
export const OBJECT_SIT_SHADOW =
  'drop-shadow(0.5px 1px 0.5px rgba(60,50,40,0.13)) drop-shadow(1.5px 3px 3px rgba(60,50,40,0.07))';
