// useDeskPhysics — drive the top-down desk physics (DeskPhysics) from React without
// re-rendering every frame: a rAF loop steps the sim and writes each body's position
// straight onto the object's DOM node (left/top/rotate). React state is only touched
// when the sim SETTLES (one batched sync, for persistence) — so a live drag/fling
// stays buttery and the existing desk render path is untouched when disabled.
//
// DeskPage owns the node registry (id → wrapper element) and the screen↔desk maths;
// this hook owns the world + the loop, and exposes grab/move/release for the drag
// handlers to call.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { DeskPhysics, initPhysics, type PhysState } from './deskPhysics';
import { svgToHull, hullPhysicsProfile, type HullPhysicsProfile } from './svgToHull';

interface DeskObjLike { id: string; x: number; y: number; rotation: number; svgMarkup: string }

interface UseDeskPhysicsArgs {
  enabled: boolean;
  /** Live objects ref (read each frame — never a dep, so the loop stays stable). */
  objectsRef: { current: DeskObjLike[] };
  /** id → the object's positioned wrapper element (top-left = x,y in desk px). */
  nodeRefs: { current: Map<string, HTMLElement> };
  /** Object footprint in desk px (square; center = x+f/2, y+f/2). */
  footprint: number;
  /** Called once the sim comes to rest: final {id → centre+rot} to persist to state/DB. */
  onSettle: (states: Map<string, PhysState>) => void;
}

export interface DeskPhysicsHandle {
  grab: (id: string, deskX: number, deskY: number) => void;
  move: (id: string, deskX: number, deskY: number) => void;
  release: (id: string, vx: number, vy: number) => void;
  active: () => boolean;
}

export function useDeskPhysics({ enabled, objectsRef, nodeRefs, footprint, onSettle }: UseDeskPhysicsArgs): DeskPhysicsHandle {
  const simRef = useRef<DeskPhysics | null>(null);
  const rafRef = useRef(0);
  const grabOffsetRef = useRef<Map<string, { dx: number; dy: number }>>(new Map());
  // Per-object convex-hull outline + its smart physics profile, computed once and reused.
  const hullCache = useRef<Map<string, number[] | null>>(new Map());
  const profileCache = useRef<Map<string, HullPhysicsProfile | null>>(new Map());
  // PLOP-IN: ids present at enable are the initial batch (no nudge); ids that appear
  // LATER (a doodle just added) get a gentle outward shove so they nudge neighbours.
  const knownIds = useRef<Set<string>>(new Set());
  const firstSync = useRef(true);
  const settledRef = useRef(true); // so onSettle fires once per motion burst, not every idle frame
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const half = footprint / 2;
    initPhysics().then(() => {
      if (!alive) return;
      const sim = new DeskPhysics();
      simRef.current = sim;
      firstSync.current = true;
      knownIds.current.clear();
      const loop = () => {
        if (!alive) return;
        // bodies follow the object set (add new, drop removed); existing keep sim state.
        // Each object's hull outline is computed once + cached (used only when its body
        // is first created, so the per-object mount cost is paid once).
        sim.sync(objectsRef.current.map((o) => {
          let hull = hullCache.current.get(o.id);
          if (hull === undefined) {
            hull = svgToHull(o.svgMarkup, footprint);
            hullCache.current.set(o.id, hull);
            // SMART per-object physics from the hull shape (weight/bounce/tumble).
            profileCache.current.set(o.id, hull ? hullPhysicsProfile(hull, footprint) : null);
          }
          const prof = profileCache.current.get(o.id) ?? null;
          return {
            id: o.id, x: o.x + half, y: o.y + half, w: footprint, h: footprint, hull: hull ?? undefined,
            density: prof?.density, restitution: prof?.restitution,
            angularDamping: prof?.angularDamping, linearDamping: prof?.linearDamping, spin: prof?.spin,
          };
        }));
        // Bouncy boundary set ONCE around the initial content + a generous fling margin,
        // so a hard throw recoils off the edge instead of sailing off the desk.
        if (!sim.hasBounds() && objectsRef.current.length) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const o of objectsRef.current) {
            minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
            maxX = Math.max(maxX, o.x + footprint); maxY = Math.max(maxY, o.y + footprint);
          }
          const M = 700;
          sim.setBounds(minX - M, minY - M, maxX + M, maxY + M);
        }
        // PLOP-IN — a doodle added AFTER the initial batch gets a gentle outward shove
        // (deterministic direction from its spot — no Math.random) so it lands with life.
        for (const o of objectsRef.current) {
          if (knownIds.current.has(o.id)) continue;
          knownIds.current.add(o.id);
          if (firstSync.current) continue;
          const a = ((o.x * 0.013 + o.y * 0.027) % (Math.PI * 2));
          // more FLOP on landing — a bigger outward shove + a little wobble-spin (its
          // own angular damping settles the wobble at its shape's pace).
          sim.nudge(o.id, Math.cos(a) * 135, Math.sin(a) * 135, (Math.cos(a) >= 0 ? 1 : -1) * 2.8);
        }
        firstSync.current = false;
        sim.step();
        const states = sim.read();
        for (const [id, st] of states) {
          let node = nodeRefs.current.get(id);
          // SELF-HEAL stale refs: a doodle that unmounted+remounted (e.g. the desk
          // re-rendered behind an edit modal) can leave the registry pointing at a
          // detached node — the sim would then drive a dead node while the live one
          // sits frozen. Re-acquire by the stable data attribute when that happens.
          if (!node || !node.isConnected) {
            node = (typeof document !== 'undefined'
              ? (document.querySelector(`[data-desk-obj-id="${id}"]`) as HTMLElement | null)
              : null) ?? undefined;
            if (node) nodeRefs.current.set(id, node);
          }
          if (!node) continue;
          node.style.left = `${Math.round(st.x - half)}px`;
          node.style.top = `${Math.round(st.y - half)}px`;
          node.style.transform = `rotate(${(st.rot * 180) / Math.PI}deg)`;
        }
        // settle edge → persist once.
        const settled = sim.isSettled();
        if (settled && !settledRef.current) onSettleRef.current(states);
        settledRef.current = settled;
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      simRef.current?.destroy();
      simRef.current = null;
      grabOffsetRef.current.clear();
      hullCache.current.clear();
      profileCache.current.clear();
      knownIds.current.clear();
    };
    // footprint is constant; objectsRef/nodeRefs are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, footprint]);

  const grab = useCallback((id: string, deskX: number, deskY: number) => {
    const sim = simRef.current;
    if (!sim || !sim.has(id)) return;
    // remember where on the body we grabbed (center px) so it doesn't snap to cursor.
    const st = sim.read().get(id);
    if (st) grabOffsetRef.current.set(id, { dx: deskX - st.x, dy: deskY - st.y });
    sim.grab(id);
    settledRef.current = false;
  }, []);

  const move = useCallback((id: string, deskX: number, deskY: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const off = grabOffsetRef.current.get(id) ?? { dx: 0, dy: 0 };
    sim.moveGrabbed(id, deskX - off.dx, deskY - off.dy);
  }, []);

  const release = useCallback((id: string, vx: number, vy: number) => {
    simRef.current?.release(id, vx, vy);
    grabOffsetRef.current.delete(id);
    settledRef.current = false;
  }, []);

  const active = useCallback(() => simRef.current != null, []);

  // Stable handle (all methods are stable) so consumers can list it in deps without churn.
  return useMemo(() => ({ grab, move, release, active }), [grab, move, release, active]);
}
