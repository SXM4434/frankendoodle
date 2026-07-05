// deskPhysics — a TOP-DOWN 2D physics world for the desk (Rapier 2D). The desk is a
// tabletop you look down on: NO gravity. Each doodle is a dynamic box that has weight,
// bumps its neighbours, can be grabbed + flung, and settles where it lands (linear +
// angular damping = tabletop friction). Pure logic, no React — the hook drives it.
//
// Coordinates are DESK pixels (same space as DeskObject.x/y); a body's position is the
// object's CENTRE (= left+w/2, top+h/2). We scale px → physics units (Rapier's solver
// likes ~0.1–10 magnitudes, not 0–2000) on the way in and back out on the way out.
//
// Rapier 2D is WASM (`@dimforge/rapier2d-compat`): `await RAPIER.init()` once before use.

import RAPIER from '@dimforge/rapier2d-compat';

/** 1 physics unit = 20 desk px — keeps the solver in a stable numeric range. */
const PX = 0.05;

export interface PhysObjInput {
  id: string;
  /** CENTRE in desk px. */
  x: number;
  y: number;
  /** footprint in desk px (fallback box if no hull). */
  w: number;
  h: number;
  /** Convex-hull outline of the doodle, CENTRED local px (flat [x0,y0,x1,y1,…]).
   *  When present the collider is this hull (physics sits behind the real shape),
   *  not the bounding box. Falls back to the w×h box if absent/degenerate. */
  hull?: number[];
  /** SMART per-object physics (signal-derived from the doodle's shape) — each falls
   *  back to the world default when absent. density = weight, restitution = bounce,
   *  angularDamping = how freely it tumbles, linearDamping = how far it skids. */
  density?: number;
  restitution?: number;
  angularDamping?: number;
  linearDamping?: number;
  /** tumble-on-throw 0–1 (elongated → spun when flung). */
  spin?: number;
}

export interface PhysState {
  /** CENTRE in desk px. */
  x: number;
  y: number;
  /** radians. */
  rot: number;
}

export interface DeskPhysicsOpts {
  /** linear damping — LOWER = carries momentum + skids further before stopping
   *  (weighty glide). Default 1.7 (was a too-feathery 3.2). */
  linearDamping?: number;
  /** angular damping — LOWER = a hit spins it a little (alive/weighty). Default 2. */
  angularDamping?: number;
  /** bounciness 0–1 — the RECOIL on impact. Default 0.42 (was a dead 0.16). */
  restitution?: number;
  /** inter-object friction — lower = they skid against each other. Default 0.45. */
  friction?: number;
  /** mass density — HIGHER = heavier, harder knocks. Default 5 (was a light 1). */
  density?: number;
  /** FLING power — the release velocity is multiplied by this. <1 calms the throw so a
   *  fast flick doesn't rocket off + sling everything it hits. Default 0.45. */
  flingScale?: number;
  /** max throw speed (desk px/s) after scaling — clamps a wild flick. Default 850. */
  maxFling?: number;
  /** When true, dynamic bodies do NOT collide with each other (only with walls) —
   *  essential for a jointed ragdoll, where self-collision fights the joints and
   *  makes it seizure. Default false (desk objects DO bump each other). */
  noSelfCollide?: boolean;
}

// Collision groups (u32 = membership<<16 | filter). Pieces only interact with walls.
const GROUP_PIECE = (0x0001 << 16) | 0x0002;
const GROUP_WALL = (0x0002 << 16) | 0x0001;

let initPromise: Promise<void> | null = null;
/** Init the Rapier WASM exactly once (idempotent across many desks/hot-reloads). */
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export class DeskPhysics {
  private world: RAPIER.World;
  private bodies = new Map<string, RAPIER.RigidBody>();
  private grabbed = new Set<string>();
  private walls: RAPIER.RigidBody[] = [];
  private spinFactors = new Map<string, number>();
  private joints: RAPIER.ImpulseJoint[] = [];
  private opts: Required<DeskPhysicsOpts>;

  /** Call `await initPhysics()` BEFORE constructing. */
  constructor(opts: DeskPhysicsOpts = {}) {
    this.opts = {
      linearDamping: opts.linearDamping ?? 1.7,
      angularDamping: opts.angularDamping ?? 2,
      restitution: opts.restitution ?? 0.3,
      friction: opts.friction ?? 0.45,
      density: opts.density ?? 5,
      flingScale: opts.flingScale ?? 0.22,
      maxFling: opts.maxFling ?? 450,
      noSelfCollide: opts.noSelfCollide ?? false,
    };
    // TOP-DOWN: zero gravity. Things move only when shoved/flung, then settle.
    this.world = new RAPIER.World({ x: 0, y: 0 });
  }

  /** Add/remove bodies so the set matches `objs`. Only NEW objects get seeded with a
   *  position; existing bodies keep their simulated state (don't fight the sim). */
  sync(objs: PhysObjInput[]): void {
    const seen = new Set<string>();
    for (const o of objs) {
      seen.add(o.id);
      if (!this.bodies.has(o.id)) this.addBody(o);
    }
    for (const [id, body] of this.bodies) {
      if (seen.has(id)) continue;
      this.world.removeRigidBody(body);
      this.bodies.delete(id);
      this.grabbed.delete(id);
      this.spinFactors.delete(id);
    }
  }

  private addBody(o: PhysObjInput): void {
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(o.x * PX, o.y * PX)
      .setLinearDamping(o.linearDamping ?? this.opts.linearDamping)
      .setAngularDamping(o.angularDamping ?? this.opts.angularDamping)
      // continuous collision detection — a fast, small body (a flung doodle
      // piece in a tight arena) must not tunnel through the boundary walls.
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bd);
    // OUTLINE collider — the doodle's convex hull (centred local px → physics units),
    // so collisions sit behind the real shape. Falls back to the bounding box.
    let cd: RAPIER.ColliderDesc | null = null;
    if (o.hull && o.hull.length >= 6) {
      const pts = new Float32Array(o.hull.length);
      for (let i = 0; i < o.hull.length; i++) pts[i] = o.hull[i] * PX;
      cd = RAPIER.ColliderDesc.convexHull(pts);
    }
    if (!cd) cd = RAPIER.ColliderDesc.cuboid((o.w / 2) * PX, (o.h / 2) * PX);
    cd.setRestitution(o.restitution ?? this.opts.restitution).setFriction(this.opts.friction).setDensity(o.density ?? this.opts.density);
    this.world.createCollider(cd, body);
    this.bodies.set(o.id, body);
    if (o.spin) this.spinFactors.set(o.id, o.spin);
  }

  /** Bouncy boundary walls (desk px) so a hard fling RECOILS off the edge instead of
   *  sailing off the desk. Replaces any previous walls. */
  setBounds(minX: number, minY: number, maxX: number, maxY: number): void {
    for (const w of this.walls) this.world.removeRigidBody(w);
    this.walls = [];
    const t = 60; // wall thickness px
    const w = maxX - minX, h = maxY - minY, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const mk = (bx: number, by: number, hw: number, hh: number) => {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(bx * PX, by * PX));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hw * PX, hh * PX).setRestitution(0.72).setFriction(0.25), body);
      this.walls.push(body);
    };
    mk(cx, minY - t / 2, w / 2 + t, t / 2); // top
    mk(cx, maxY + t / 2, w / 2 + t, t / 2); // bottom
    mk(minX - t / 2, cy, t / 2, h / 2 + t); // left
    mk(maxX + t / 2, cy, t / 2, h / 2 + t); // right
  }

  hasBounds(): boolean {
    return this.walls.length > 0;
  }

  has(id: string): boolean {
    return this.bodies.has(id);
  }

  /** GRAB — the body becomes kinematic so it tracks the cursor exactly and SHOVES
   *  neighbours out of the way (its motion imparts momentum to what it hits). */
  grab(id: string): void {
    const b = this.bodies.get(id);
    if (!b) return;
    b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.grabbed.add(id);
  }

  /** Move a grabbed body to a new CENTRE (desk px). */
  moveGrabbed(id: string, cx: number, cy: number): void {
    const b = this.bodies.get(id);
    if (b && this.grabbed.has(id)) b.setNextKinematicTranslation({ x: cx * PX, y: cy * PX });
  }

  /** RELEASE — back to dynamic, carrying the fling velocity (desk px/s). */
  release(id: string, vx: number, vy: number): void {
    const b = this.bodies.get(id);
    if (!b) return;
    b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    // Scale + clamp the throw so a fast flick doesn't rocket off and sling everything.
    let svx = vx * this.opts.flingScale, svy = vy * this.opts.flingScale;
    const sp = Math.hypot(svx, svy);
    if (sp > this.opts.maxFling) { const k = this.opts.maxFling / sp; svx *= k; svy *= k; }
    b.setLinvel({ x: svx * PX, y: svy * PX }, true);
    // TUMBLE — elongated shapes get spun proportional to throw speed (visible whirl);
    // direction follows the throw's curl so it reads natural. Round shapes (spin~0) roll straight.
    const spin = this.spinFactors.get(id) ?? 0;
    if (spin > 0.01) {
      const speed = Math.hypot(svx, svy) * PX;
      const dir = svx >= 0 ? 1 : -1;
      b.setAngvel(dir * spin * speed * 0.9, true);
    }
    this.grabbed.delete(id);
  }

  /** A new doodle PLOPS in — an outward shove (+ optional spin) so it lands with a
   *  little flop/wobble and nudges its neighbours. */
  nudge(id: string, vx: number, vy: number, spin = 0): void {
    const b = this.bodies.get(id);
    if (!b) return;
    b.setLinvel({ x: vx * PX, y: vy * PX }, true);
    if (spin) b.setAngvel(spin, true);
  }

  /** RAGDOLL — connect two bodies with a revolute joint at the midpoint between
   *  their current centres, so they hang together like a rigged character:
   *  drag one and the chain follows; a shake makes it flail but stay joined. */
  link(id1: string, id2: string): void {
    const b1 = this.bodies.get(id1);
    const b2 = this.bodies.get(id2);
    if (!b1 || !b2) return;
    const t1 = b1.translation();
    const t2 = b2.translation();
    const mx = (t1.x + t2.x) / 2;
    const my = (t1.y + t2.y) / 2;
    const jd = RAPIER.JointData.revolute({ x: mx - t1.x, y: my - t1.y }, { x: mx - t2.x, y: my - t2.y });
    this.joints.push(this.world.createImpulseJoint(jd, b1, b2, true));
  }

  /** Apply an instantaneous impulse (desk px units) — the NPC "brain" uses this
   *  to steer the creature toward a target, breathe, and react to pokes. */
  applyImpulse(id: string, fx: number, fy: number): void {
    const b = this.bodies.get(id);
    if (b) b.applyImpulse({ x: fx * PX, y: fy * PX }, true);
  }

  /** A body's current centre (desk px), or null. */
  centre(id: string): { x: number; y: number } | null {
    const b = this.bodies.get(id);
    if (!b) return null;
    const t = b.translation();
    return { x: t.x / PX, y: t.y / PX };
  }

  isGrabbed(id: string): boolean {
    return this.grabbed.has(id);
  }

  /** Advance the sim one tick (call once per animation frame). */
  step(): void {
    this.world.step();
  }

  /** Current CENTRES + rotations, in desk px. */
  read(): Map<string, PhysState> {
    const out = new Map<string, PhysState>();
    for (const [id, b] of this.bodies) {
      const t = b.translation();
      out.set(id, { x: t.x / PX, y: t.y / PX, rot: b.rotation() });
    }
    return out;
  }

  /** True once every (non-grabbed) body has come to rest — for syncing final
   *  positions back to React/DB without polling every frame. */
  isSettled(epsilon = 0.02): boolean {
    for (const [id, b] of this.bodies) {
      if (this.grabbed.has(id)) return false;
      const v = b.linvel();
      if (Math.hypot(v.x, v.y) > epsilon || Math.abs(b.angvel()) > epsilon) return false;
    }
    return true;
  }

  destroy(): void {
    this.world.free();
    this.bodies.clear();
    this.grabbed.clear();
    this.spinFactors.clear();
    this.walls = [];
    this.joints = [];
  }
}
