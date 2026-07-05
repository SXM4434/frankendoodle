# Project Purpose

**Desk Doodles** — ConFigMakeathon submission ($100k prizes, deadline **2026-06-18 11:59 PM PDT**, solo allowed). Multi-mode canvas web app: user draws or uploads (image/SVG); app converts between modes (SVG ↔ 3D) and applies styling. Cached in Supabase backend so canvas mode-flip doesn't re-generate.

The headline wedge: **an intelligent design system that picks the right transformation per region per source** (Smart Hachure inside SVG mode + Free Stroke engine for draw→3D + Tripo cloud AI for complex upload→3D).

This is its own standalone product — own brand, own public GitHub, post-makeathon standalone potential. **Local-canonical workflow:** dev happens here; Make is deployment only (never push Make back to GitHub).

**Port-back to portfolio / Hero-8-Lab / visitor playground = POST-MAKEATHON triage.** Don't pre-plan or track during the build. After 2026-06-18 we figure out what flows back.

---

# Repo Location

```
~/Desktop/Projects/desk-doodles/
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   ├── DeskDoodles/      ← canvas + audit pages
│   │   │   ├── canvas/           ← SvgStyleTransform.tsx (main render component)
│   │   │   └── chrome/           ← SmartHachureChrome + modifierSpecs
│   │   ├── lib/
│   │   │   ├── smartHachure/     ← the shading sub-system
│   │   │   ├── items/            ← PegToolShape.tsx (197-shape catalog)
│   │   │   ├── f3HandFeel.ts     ← playground-native hand-feel primitives
│   │   │   └── handFeel.ts
│   │   ├── state/                ← React contexts (F3RoughModifiersContext etc.)
│   │   └── routes.tsx
├── audit-runs/                   ← per-style sweep reports (2026-06-08 onward)
├── public/
├── package.json
└── vite.config.ts
```

GitHub: `https://github.com/SXM4434/desk-doodles` (public, for Build-in-Public).

---

# Current Workflow Status

**Day 10 of 14** (deadline 2026-06-18). Days 1-4 = Hero-8-Lab foundation · Day 5 = fork · Day 6 = chrome rebuild + pipeline bug pass · Day 7 = /canvas v1 + audit catalog · Day 8-9 = drawn-canvas overhaul + 681-sweep + Make checkpoint #1 + doc mirror + research synthesis v1.2 (Make smoke test ✅, Contra URL ✅).

**Open fronts:** M9 public canvas + Supabase (Day 10) — the desk-canvas + draw-panel-popup flow MUST be folded in here, it has no other plan slot · 3D easy-path Rod/Extrude (Day 11). Wobble thread CLOSED — Sebs eyes-on sign-off 2026-06-10.

**Outstanding small:** upload-image input = stretch S1 (buffer day, needs tracer dep — not small) · 3D toggle waits for Day 11 (honesty gate shipped) · Sebs-side: Supabase project keys, Tripo key rotation, fal.ai/TRELLIS account, daily Make-beta email check.

---

# Locked Working Stack

- **Framework:** Vite + React + TypeScript
- **Physics:** **Rapier** via `@react-three/rapier` (CHANGED 2026-06-25 — Sebs self-hosting off Figma Make; the no-Rapier ruling was Make-platform-only, now lifted per `project_desk_doodles_no_rapier_in_make`. cannon-es dropped.)
- **3D:** @react-three/fiber + @react-three/drei + @react-three/cannon
- **Backend:** Supabase (for cached conversions + public canvas)
- **Drawing primitive:** perfect-freehand
- **SVG AST:** svgson (available for future structural work)
- **Design system:** portfolio tokens (W1/W1-D + ISe ladder + locked spacing) are the WORKING SCAFFOLD only — Desk Doodles earns its OWN design + motion language at the Day 12-13 system pass (per project_desk_doodles_own_design_language). Don't stop mid-build to systematize; don't ship a portfolio reskin either.

This stack is locked. Physics = Rapier (`@react-three/rapier`) now that we self-host; don't add OTHER physics libs. Smart Hachure stays inside SVG mode.

---

# Commands

```bash
cd ~/Desktop/Projects/desk-doodles
npm install
npm run dev      # localhost:5182
npm run build
```

Other dev servers may be running:
- Hero-8-Lab → localhost:5181
- Homepage Surfaces v2 Lab → localhost:5180

---

# Working Rules

- This repo (`~/Desktop/Projects/desk-doodles/`) is the source of truth for Desk Doodles work
- **Local is canonical, Make is deployment** — Make→GitHub auto-push is DISABLED in practice; manually port Make-AI fixes back to local
- Inspect existing components/lib before inventing new structure
- Smart Hachure obeys `09-LOCKED-MODEL.md` (in portfolio) — I-1 through I-14 invariants are sacred
- User's fillStyle + Style dropdowns are SACRED (I-1); narrow `fillStyle` override only (per `feedback_fillstyle_slider_must_switch_classifier_pick`)
- Source darkness owns per-region perceptual identity (I-2)
- All ~13 sliders stay; 6+ ticks each; bias within band (I-3) — see `feedback_more_toggle_options_better`
- Build FULL phase scope — don't self-stop at MVP per `feedback_build_full_dont_self_stop_at_mvp`
- For visual rendering bugs: build playwright/console diagnostic FIRST per `feedback_diagnose_with_real_data_first` — don't guess from source
- Before claiming any fix done: baseline-screenshot 6 representative shape classes + apply fix + re-screenshot + diff + run sweep harness per `feedback_never_declare_fixed_without_regression_check`
- Never claim "checked all" after sampling per `feedback_no_sampled_verification_claims` — iterate every item with the debug method, show per-item table
- Don't shortcut the audit-catalog process — `/audit` IS the smart-layer training dataset per `project_smart_layer_foundation_via_audit`

---

# Session Handoff Rules

- Claude is responsible for updating `SESSION-HANDOFF.md` in THIS repo — do not wait to be asked
- Refresh the handoff at meaningful checkpoints during long sessions, not only at the end
- Meaningful checkpoints: completed subtasks, locked decisions, file changes, or any point where context loss would be costly
- If compression risk feels high, refresh early — prefer redundant refreshes over losing state
- Keep the handoff short, factual, and action-oriented — one screen is the target
- Record only: current state, real changes, locked decisions, unresolved questions, next move
- Do not duplicate locked docs or re-paste long chat summaries
- At the start of a new session, read `CLAUDE.md` then `SESSION-HANDOFF.md` before resuming work
- This applies both to manual session endings and to context-compressed session continuations
- **Do NOT write Desk Doodles state into the portfolio repo's `SESSION-HANDOFF.md`** — that's the rule that created this split

---

# Useful Imports

@SESSION-HANDOFF.md

# Pull Manually When Needed

All load-bearing docs are now **mirrored locally** at `docs/` for self-contained makeathon work. Source-of-truth still lives in the portfolio repo; this folder is a 2026-06-10 snapshot.

**Local mirror (read FIRST for any non-trivial work):**

- `docs/README.md` — index + read-order guide
- `docs/locked-refs/F3-smart-hachure-system/09-LOCKED-MODEL.md` — Smart Hachure contract (I-1..I-13). THE CONTRACT.
- `docs/locked-refs/F3-smart-hachure-system/makeathon-plan.md` — 14-day plan + §8.6 Smart Rendering System
- `docs/locked-refs/F3-siblings/F3-shading-calibration-spec.md` — per-modifier math + ranges + bugs
- `docs/locked-refs/F3-siblings/F3-toggle-architecture.md` — 7-axis taxonomy + 3D Path 1 styles + rotation-stability research
- `docs/locked-refs/F3-smart-hachure-system/19-research-cross-axis-interconnection.md` — 5-cluster matrix
- `docs/locked-refs/F3-smart-hachure-system/20-research-figma-make-capabilities.md` — Make constraints (anchors NO Rapier)
- `docs/locked-refs/F3-smart-hachure-system/18-scope-audit.md` — 9 D-decisions locked
- `docs/locked-refs/F3-smart-hachure-system/07-architecture-ml-pipeline.md` — `signals → classify → treatment` pipeline + audit-as-foundation
- `docs/locked-refs/system/` — locked color (W1), typography, spacing, cross-system-rules, north-star-filter
- `docs/memory/project_desk_doodles_makeathon.md` — THE project memory (scope, deadline, app architecture)
- `docs/memory/project_f3_shading_port_to_3d.md` — SVG and 3D have SEPARATE Style dropdowns; SVG-port bridges via EdgesGeometry
- `docs/memory/project_generalizable_rendering_decision_pattern.md` — pipeline pattern is GENERAL; don't pre-build meta-engine
- `docs/research/` — original-here research synthesized during Desk Doodles work

**Source-of-truth (don't edit the local mirror — edit there, then re-mirror):**

- Portfolio repo: `~/Desktop/Projects/portfolio/portfolio-system-lab/docs/`
- Memory: `~/.claude/projects/-Users-sebs/memory/`

Port-back of any work TO portfolio happens post-makeathon (after 2026-06-18).
