# Desk Doodles

Doodle the little things on your desk. Restyle them with a real hand-drawn engine. Flip them between 2D and 3D. Leave them on a live shared desk next to everyone else's.

Designers sketch at their desks constantly — there's no shared space that makes that habit social and visible. Desk Doodles is that space, built on one bet: **your hand's character — wobble, pressure, stroke grammar — is the material, not noise.**

## What it does

- **Draw or upload**, then restyle parametrically: hatching, stipple, charcoal, risograph and more, driven by ~13 live axes (gap, weight, wobble, pen tip, layers…) — an engine making decisions per region per source, not a stamped filter
- **The creation loop:** sketch (raw ink, pen-up never commits) → flip to Style and tune → name your doodle like minting a card → place it → reopen any time to restyle or **re-draw your original strokes**
- **2D ↔ 3D:** the same strokes become rods, extrusions, inflated forms, or fused solids — orbit them live; the mark family carries across (the round-trip is the point)
- **The shared desk:** publish and it lands on a live public desk; other people's doodles arrive in realtime; desks fill, hit their cap, and spawn the next one — a wall of walls at `/desks`
- **Your drawer:** everything you've made, across every desk, ready to re-place

## Why it's different

Every shipping sketch-to-3D tool optimizes *fidelity-to-intent* (clean printable CAD) or *fidelity-to-mesh* (clean textured assets) — both strip the hand. Desk Doodles owns the third pole: **the user's hand survives the round-trip.** Sketch in, sketch out, signature intact.

## Built for

**[ConFigMakeathon](https://contra.com/community/topic/configmakeathon/guidelines)** — built in Figma Make + a local Vite workflow, building in public throughout. Deadline 2026-06-18.

## Stack

- **Build:** Figma Make + local Vite (local-canonical; Make checkpoints)
- **Frontend:** React + TypeScript
- **Drawing:** perfect-freehand + rough.js under a custom parametric mark engine (Smart Hachure)
- **3D:** Three.js + React Three Fiber + Drei (no WASM — Make-safe); geometry engine shared with [Free Stroke](https://github.com/SXM4434/free-stroke)
- **Backend:** Supabase — anonymous sessions, realtime shared desks, session-scoped RPCs
- **Quality:** a 197-shape `/audit` catalog doubles as the regression surface and the smart-layer training dataset; golden-label diffing gates every engine change

## Status

Day 12 of 14 — the desk is live, the creation loop is closed, 3D is real. See `git log` for the whole trail.
