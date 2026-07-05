import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SvgStyleTransform } from '../canvas/SvgStyleTransform';
import { StyleScope } from './StyleScope';
import { FdDoodle, type DoodleName } from './FdDoodle';
import { IS } from '../../lib/typography';
import { pieceMarkup, panelLayout, type FdPanel } from '../../lib/frankendoodle/compose';
import { fdSfx, fdAudioInit, fdSetMuted, fdMuted } from '../../lib/frankendoodle/fdSound';
import type { F3SvgStyle } from '../../state/F3SvgStyleContext';
import type { F3ModifiersState } from '../../state/F3RoughModifiersContext';

// The living creature — the drawing brought to life as a fully-rigged character.
// The three drawn panels are its TRUNK; on top of that it grows an articulated
// LIMB SYSTEM: two arms + two legs, each a real 2-bone IK chain (shoulder→elbow→
// hand, hip→knee→foot) driven by a walk cycle with foot-planting. It has
// expressive eyes (blink, look, widen, squint), a 5-phase startle reflex, and
// procedural sound. Built on Disney's 12 principles — anticipation → snap →
// settle → recover, volume-preserving squash & stretch, overlap, arcs.

interface Part {
  markup: string;
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  w: number;
  h: number;
}

type Mood = 'idle' | 'curious' | 'playful' | 'happy' | 'startled' | 'sleepy';
type StartlePhase = 'calm' | 'tell' | 'react' | 'settle' | 'recover';

// 2-bone IK: given a root and a target, place the mid joint. `bend` (±1) picks
// which way the knee/elbow flexes. Target is clamped to the reachable annulus.
function ik2(rx: number, ry: number, tx: number, ty: number, l1: number, l2: number, bend: number) {
  let dx = tx - rx;
  let dy = ty - ry;
  let d = Math.hypot(dx, dy) || 0.001;
  const maxD = l1 + l2 - 0.01;
  const minD = Math.abs(l1 - l2) + 0.01;
  const dc = Math.max(minD, Math.min(maxD, d));
  const ux = dx / d;
  const uy = dy / d;
  const ex = rx + ux * dc; // reachable end
  const ey = ry + uy * dc;
  const cosA = Math.max(-1, Math.min(1, (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc)));
  const a = Math.acos(cosA);
  const base = Math.atan2(ey - ry, ex - rx);
  const ja = base + bend * a;
  return { jx: rx + Math.cos(ja) * l1, jy: ry + Math.sin(ja) * l1, ex, ey };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function FdPhysics({
  panels,
  configs,
  onExit,
}: {
  panels: FdPanel[];
  configs: { svgStyle: F3SvgStyle; mods: F3ModifiersState }[];
  onExit?: () => void;
}) {
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const partRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const eyesBoxRef = useRef<HTMLDivElement | null>(null);
  const eyeRefs = useRef<(SVGGElement | null)[]>([]); // [L,R] eye groups
  const pupRefs = useRef<(SVGGElement | null)[]>([]); // [L,R] pupils
  const limbRefs = useRef<(SVGPathElement | null)[]>([]); // [legL, legR, armL, armR]
  const [size, setSize] = useState<{ w: number; h: number }>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [parts, setParts] = useState<Part[]>([]);
  const [treat, setTreat] = useState<{ x: number; y: number } | null>(null);
  const [emote, setEmote] = useState<{ kind: DoodleName; id: number } | null>(null);
  const [muted, setMuted] = useState(false);
  const treatRef = useRef<{ x: number; y: number } | null>(null);
  treatRef.current = treat;
  const hoverRef = useRef<{ x: number; y: number; t: number; vx: number; vy: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const emoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stRef = useRef({
    x: 0, y: 0, vx: 0, vy: 0,
    walk: 0, walkPhase: 0, face: 1, lean: 0, hop: 0, prevHop: 0, squashPulse: 0,
    tilt: 0, idleLook: 0,
    mood: 'curious' as Mood, energy: 0.6, affection: 0,
    moodHold: 0, startleCool: 0,
    wx: 0, wy: 0, wanderT: 0, arcSign: 1, phase: 0,
    emoteAt: -9999, babbleAt: 0, nearT: 0,
    // startle reflex
    stPhase: 'calm' as StartlePhase, stT: 0, stDeg: 0, tremble: 0, eyeWide: 0,
    // eyes
    blinkT: 1.5, blink: 0, pupX: 0, pupY: 0, lidTarget: 1, lid: 1,
    // limb actual positions (world), lerped for smoothing
    legs: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    arms: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    footDown: [false, false],
    inited: false,
  });

  // Personality derived from HOW the creature was drawn (character-appeal).
  const persona = useMemo(() => {
    const seed = panels.reduce((a, p) => a + p.strokes.length * 13 + p.strokes.reduce((b, s) => b + s.points.length, 0), 0);
    const r = (n: number) => (Math.sin(seed * 0.017 + n) + 1) / 2;
    return {
      curiosity: 0.55 + r(1.1) * 0.5,
      timid: 0.2 + r(2.3) * 0.65,
      play: 0.4 + r(3.7) * 0.6,
      speed: 0.8 + r(5) * 0.55,
    };
  }, [panels]);

  useEffect(() => {
    fdAudioInit();
  }, []);

  useLayoutEffect(() => {
    const el = arenaRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize((p) => (Math.abs(p.w - r.width) < 1 && Math.abs(p.h - r.height) < 1 ? p : { w: r.width, h: r.height }));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // build the rig segments (head / torso / legs) — the trunk
  useEffect(() => {
    const { boxes, viewBox } = panelLayout(panels);
    const scale = Math.min(230 / viewBox.h, (size.w * 0.36) / viewBox.w);
    setParts(
      panels.map((p, i) => ({
        markup: pieceMarkup(p),
        svgStyle: configs[i]?.svgStyle ?? p.svgStyle,
        mods: configs[i]?.mods ?? p.mods,
        w: Math.max(24, boxes[i].w * scale + 16),
        h: Math.max(24, boxes[i].h * scale + 16),
      })),
    );
    if (stRef.current.x === 0) {
      stRef.current.x = size.w / 2;
      stRef.current.y = size.h * 0.42;
    }
  }, [panels, configs, size.w, size.h]);

  const puff = (kind: DoodleName, gap = 1500) => {
    const st = stRef.current;
    const now = performance.now();
    if (now - st.emoteAt < gap) return;
    st.emoteAt = now;
    setEmote({ kind, id: Math.round(now) });
    if (emoteTimer.current) clearTimeout(emoteTimer.current);
    emoteTimer.current = setTimeout(() => setEmote(null), 1600);
  };

  const triggerStartle = (deg: number) => {
    const st = stRef.current;
    if (st.stPhase !== 'calm' && st.stDeg >= deg) return; // don't downgrade an ongoing scare
    if (st.startleCool > 0 && deg < 3) return;
    st.stPhase = 'tell';
    st.stT = 0;
    st.stDeg = deg;
    st.startleCool = 1.3;
    st.mood = 'startled';
    st.moodHold = 0.6 + deg * 0.15;
    fdSfx.startle();
    puff('excl', 500);
  };

  // the AI brain + full procedural rig loop
  useEffect(() => {
    if (parts.length < 1) return;
    let raf = 0;
    let alive = true;
    let last = performance.now();
    const st = stRef.current;
    (window as unknown as { __creature?: unknown }).__creature = st;
    if (st.x === 0) {
      st.x = size.w / 2;
      st.y = size.h * 0.42;
    }
    const hh = parts[0].h;
    const th = parts[1]?.h ?? hh;
    const lh = parts[2]?.h ?? th;
    const bodyW = parts[1]?.w ?? 90;
    const trunkH = hh * 0.55 + th + lh * 0.7;
    const legLen = Math.max(46, Math.min(96, trunkH * 0.52));
    const armLen = Math.max(38, Math.min(84, trunkH * 0.46));
    const hipSpread = bodyW * 0.24;
    const shoulderSpread = bodyW * 0.44;

    const tick = () => {
      if (!alive) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      st.phase += dt;
      st.energy = Math.max(0.05, st.energy - dt * 0.03);
      st.moodHold -= dt;
      st.startleCool -= dt;
      st.affection = Math.max(0, st.affection - dt * 0.25);

      const hv = hoverRef.current;
      const cursorOn = !!hv && now - hv.t < 1500;
      const dragging = !!dragRef.current && dragRef.current.moved;
      const treatPt = treatRef.current;
      const dCur = cursorOn && hv ? Math.hypot(hv.x - st.x, hv.y - st.y) : Infinity;
      const cSpeed = hv ? Math.hypot(hv.vx, hv.vy) : 0;
      const bodyR = bodyW * 0.7 + 26;
      const nearBody = dCur < bodyR + 30;

      // ── PETTING: slow glide over the body soothes (interactive affection)
      if (cursorOn && nearBody && cSpeed < 520 && !dragging && st.stPhase === 'calm') {
        st.affection = Math.min(1, st.affection + dt * 1.3);
        st.energy = Math.min(1, st.energy + dt * 0.25);
      }

      // ── STARTLE trigger: a fast swipe WHILE ALREADY hovering — a lunge, not a
      // normal approach. Requires having been near for a beat so that simply
      // moving your cursor over to pet it never spooks it.
      if (cursorOn && dCur < 190) st.nearT += dt; else st.nearT = 0;
      if (cursorOn && cSpeed > 2200 && dCur < 140 && st.nearT > 0.08 && st.startleCool <= 0) {
        const deg = dCur < 70 || cSpeed > 3600 ? 3 : dCur < 115 || cSpeed > 2900 ? 2 : 1;
        triggerStartle(deg);
      }

      // ── STARTLE state machine (anticipation → snap → settle → recover)
      let stretchMod = 0;
      let trembleX = 0;
      const S = st;
      if (S.stPhase !== 'calm') {
        S.stT += dt;
        const deg = S.stDeg;
        const tellDur = 0.08 + deg * 0.025;
        const reactDur = 0.1;
        const settleDur = 0.24 + deg * 0.08;
        const recoverDur = 0.3 + deg * 0.2;
        if (S.stPhase === 'tell') {
          stretchMod = 0.03; // perk/freeze
          S.eyeWide = Math.max(S.eyeWide, 0.4);
          if (S.stT >= tellDur) {
            S.stPhase = 'react';
            S.stT = 0;
            S.squashPulse = 0.12 + deg * 0.05; // crouch
            S.hop = deg >= 2 ? 16 + deg * 9 : 8;
            if (deg >= 3 && hv) {
              const dx = st.x - hv.x;
              const dy = st.y - hv.y;
              const d = Math.hypot(dx, dy) || 1;
              st.vx += (dx / d) * 520;
              st.vy += (dy / d) * 240;
            }
            fdSfx.hop();
          }
        } else if (S.stPhase === 'react') {
          stretchMod = 0.06 + deg * 0.05; // stretch up, hit-stop hold
          S.eyeWide = 1;
          if (S.stT >= reactDur) {
            S.stPhase = 'settle';
            S.stT = 0;
          }
        } else if (S.stPhase === 'settle') {
          const k = Math.min(1, S.stT / settleDur);
          trembleX = Math.sin(S.stT * 46) * (3 + deg * 2) * (1 - k);
          S.eyeWide = 0.6 * (1 - k);
          if (S.stT >= settleDur) {
            S.stPhase = 'recover';
            S.stT = 0;
          }
        } else if (S.stPhase === 'recover') {
          const k = Math.min(1, S.stT / recoverDur);
          trembleX = Math.sin(S.stT * 30) * 1.5 * (1 - k);
          S.eyeWide = 0.4 * (1 - k);
          if (S.stT >= recoverDur) {
            S.stPhase = 'calm';
            S.eyeWide = 0;
          }
        }
      }

      // ── DECIDE mood (hysteresis; startle owns the mood while active)
      if (st.moodHold <= 0 && !dragging && st.stPhase === 'calm') {
        if (treatPt) st.mood = 'playful';
        else if (st.affection > 0.55) { st.mood = 'happy'; puff('heart', 1300); }
        else if (cursorOn && dCur < 340) { st.mood = st.energy > 0.45 ? 'playful' : 'curious'; puff(st.energy > 0.45 ? 'spark' : 'question', 2600); }
        else if (st.energy < 0.14) { st.mood = 'sleepy'; puff('zzz', 2600); }
        else st.mood = 'idle';
        st.moodHold = 0.3;
      }

      // ── pick a goal + speed
      let tx = st.x;
      let ty = st.y;
      let speedWant = 0;
      if (treatPt) {
        tx = treatPt.x; ty = treatPt.y; speedWant = 230 * persona.speed;
        if (Math.hypot(tx - st.x, ty - st.y) < 38) {
          setTreat(null);
          st.energy = Math.min(1, st.energy + 0.45);
          st.hop = 30; st.squashPulse = 0.3; st.mood = 'happy'; st.moodHold = 0.7;
          fdSfx.munch(); puff('heart', 400);
        }
      } else if (st.mood === 'startled' && hv) {
        const dx = st.x - hv.x, dy = st.y - hv.y, d = Math.hypot(dx, dy) || 1;
        tx = st.x + (dx / d) * 300; ty = st.y + (dy / d) * 300;
        speedWant = 300 * (0.7 + persona.timid);
      } else if ((st.mood === 'curious' || st.mood === 'playful') && hv) {
        const dx = hv.x - st.x, dy = hv.y - st.y, d = Math.hypot(dx, dy) || 1;
        const want = st.mood === 'playful' ? 66 : 104;
        tx = hv.x - (dx / d) * want; ty = hv.y - (dy / d) * want;
        speedWant = (st.mood === 'playful' ? 185 : 122) * persona.curiosity;
      } else if (st.mood === 'happy' || st.mood === 'sleepy') {
        speedWant = 0;
      } else {
        if (st.phase > st.wanderT || Math.hypot(st.wx - st.x, st.wy - st.y) < 60) {
          st.wanderT = st.phase + 1.8 + Math.random() * 2.2;
          const farX = st.x < size.w / 2 ? size.w * (0.55 + Math.random() * 0.4) : size.w * (0.05 + Math.random() * 0.4);
          st.wx = Math.max(80, Math.min(size.w - 80, farX));
          st.wy = size.h * 0.3 + Math.random() * Math.max(1, size.h * 0.42);
          st.arcSign = Math.random() < 0.5 ? -1 : 1;
        }
        tx = st.wx; ty = st.wy; speedWant = 138 * persona.speed;
      }

      // ── LOCOMOTE (arc steering, ease-in, velocity clamp)
      if (!dragging) {
        let dx = tx - st.x, dy = ty - st.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 5 && speedWant > 0) {
          const perpX = -dy / dist, perpY = dx / dist;
          const arc = st.arcSign * Math.min(0.5, dist / 900) * (st.mood === 'startled' ? 0 : 1);
          dx += perpX * dist * arc; dy += perpY * dist * arc;
          const dd = Math.hypot(dx, dy) || 1;
          const ease = Math.min(1, dist / 55);
          const k = Math.min(1, dt * (st.mood === 'startled' ? 8 : 4.5));
          st.vx += ((dx / dd) * speedWant * ease - st.vx) * k;
          st.vy += ((dy / dd) * speedWant * ease - st.vy) * k;
        } else {
          st.vx *= 0.85; st.vy *= 0.85;
        }
        const sp = Math.hypot(st.vx, st.vy);
        if (sp > 380) { st.vx = (st.vx / sp) * 380; st.vy = (st.vy / sp) * 380; }
        st.x += st.vx * dt; st.y += st.vy * dt;
        const m = 54, topM = m + 34, botM = m + 90;
        if (st.x < m) { st.x = m; st.vx = Math.abs(st.vx) * 0.45; }
        else if (st.x > size.w - m) { st.x = size.w - m; st.vx = -Math.abs(st.vx) * 0.45; }
        if (st.y < topM) { st.y = topM; st.vy = Math.abs(st.vy) * 0.45; }
        else if (st.y > size.h - botM) { st.y = size.h - botM; st.vy = -Math.abs(st.vy) * 0.45; }
      }

      // ── TRUNK pose
      const speed = Math.hypot(st.vx, st.vy);
      const moving = speed > 16;
      st.walk += speed * dt * 0.03 + dt * (st.mood === 'sleepy' ? 0.3 : 0.7);
      st.walkPhase += (moving ? speed * dt * 0.011 : 0);
      if (Math.abs(st.vx) > 16) st.face = st.vx > 0 ? 1 : -1;
      const leanTarget = Math.max(-0.24, Math.min(0.24, st.vx * 0.001));
      st.lean += (leanTarget - st.lean) * Math.min(1, dt * 5);
      st.hop *= 0.85;
      const wiggle = st.mood === 'happy' ? Math.sin(st.phase * 16) * 0.09 : 0;
      st.idleLook += (Math.sin(st.phase * 0.6) * 0.16 - st.idleLook) * Math.min(1, dt * 2);
      const lookTarget = cursorOn && hv ? Math.max(-0.42, Math.min(0.42, (hv.x - st.x) / 190)) : st.idleLook;
      st.tilt += (lookTarget + wiggle - st.tilt) * Math.min(1, dt * 6);

      // squash & stretch (volume preserving)
      if (st.prevHop > 8 && st.hop <= 8) { st.squashPulse = Math.max(st.squashPulse, 0.3); if (st.hop < 2) fdSfx.land(); }
      st.prevHop = st.hop;
      st.squashPulse *= 0.82;
      const breath = Math.sin(st.phase * 2.1) * (0.02 + st.energy * 0.012);
      const sqRaw = 1 + st.hop * 0.005 + breath - st.squashPulse + stretchMod;
      const sq = Math.max(0.62, Math.min(1.5, sqRaw));
      const hs = 1 / Math.sqrt(sq);

      const rx = st.x + trembleX; // render-only x (tremble)
      const bob = Math.sin(st.walk * 2) * Math.min(11, 3 + speed * 0.03) * (0.5 + st.energy * 0.6);
      const torsoY = st.y + bob - st.hop;
      const face = st.face;

      // trunk parts
      const torsoEl = partRefs.current[1];
      const tw = parts[1]?.w ?? 0;
      if (torsoEl) torsoEl.style.transform = `translate(${rx - tw / 2}px, ${torsoY - th / 2}px) rotate(${st.lean}rad) scale(${hs * face}, ${sq})`;
      const headEl = partRefs.current[0];
      const hw = parts[0].w;
      const headLag = Math.sin(st.walk * 2 - 0.7) * 2.4;
      const neckY = torsoY - th * 0.42 * sq;
      const headTopY = neckY - hh + breath * 40 + headLag;
      if (headEl) headEl.style.transform = `translate(${rx - hw / 2 + st.lean * 22}px, ${headTopY}px) rotate(${st.tilt + st.lean * 0.5}rad) scale(${hs * face}, ${sq})`;
      const legsEl = partRefs.current[2];
      const lw = parts[2]?.w ?? 0;
      const waistY = torsoY + th * 0.4 * sq;
      const pelvisBottom = waistY + lh * 0.6 * sq;
      if (legsEl) legsEl.style.transform = `translate(${rx - lw / 2}px, ${waistY}px) rotate(${Math.sin(st.walk + 0.5) * 0.05 + st.lean}rad) scale(${hs * face}, ${sq})`;

      // ── LIMB RIG (IK) — legs from the pelvis, arms from the shoulders
      const groundY = pelvisBottom + legLen * 0.9;
      const stride = Math.min(48, 14 + speed * 0.14) * face;
      const legLift = Math.min(26, 9 + speed * 0.05);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const hipX = rx + side * hipSpread * hs;
        const hipY = pelvisBottom;
        // rest stance vs walk cycle
        let footTX: number;
        let footTY: number;
        if (moving) {
          const p = (st.walkPhase + i * 0.5) % 1;
          if (p < 0.6) { const s = p / 0.6; footTX = hipX + stride * (0.5 - s); footTY = groundY; }
          else { const s = (p - 0.6) / 0.4; footTX = hipX + stride * (-0.5 + s); footTY = groundY - Math.sin(s * Math.PI) * legLift; }
        } else {
          footTX = hipX + side * 3;
          footTY = groundY - Math.abs(Math.sin(st.phase * 1.4 + i)) * 1.5; // idle weight shift
        }
        const leg = st.legs[i];
        if (!st.inited) { leg.x = footTX; leg.y = footTY; }
        const wasDown = leg.y > groundY - 3;
        leg.x = lerp(leg.x, footTX, Math.min(1, dt * 18));
        leg.y = lerp(leg.y, footTY, Math.min(1, dt * 18));
        const nowDown = leg.y > groundY - 3;
        if (moving && nowDown && !wasDown) fdSfx.step();
        const bend = face >= 0 ? 1 : -1; // knee forward
        const k = ik2(hipX, hipY, leg.x, leg.y, legLen * 0.52, legLen * 0.5, bend);
        const toeX = leg.x + face * 9;
        const toeY = leg.y;
        const path = limbRefs.current[i];
        if (path) path.setAttribute('d', `M${hipX.toFixed(1)} ${hipY.toFixed(1)} L${k.jx.toFixed(1)} ${k.jy.toFixed(1)} L${leg.x.toFixed(1)} ${leg.y.toFixed(1)} L${toeX.toFixed(1)} ${toeY.toFixed(1)}`);
      }

      // arms
      const shoulderY = torsoY - th * 0.28 * sq;
      const armSwing = Math.sin(st.walkPhase * Math.PI * 2) * Math.min(26, 8 + speed * 0.06);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const shX = rx + side * shoulderSpread * hs;
        const shY = shoulderY;
        let handTX: number;
        let handTY: number;
        const reachToCursor = (st.mood === 'curious' || st.mood === 'playful') && cursorOn && hv && dCur < 260;
        if (st.stPhase === 'react' || st.stPhase === 'tell') {
          // fling hands up (brace)
          handTX = shX + side * armLen * 0.5; handTY = shY - armLen * 0.7;
        } else if (st.mood === 'happy') {
          handTX = shX + side * armLen * 0.5; handTY = shY - armLen * 0.4 + Math.sin(st.phase * 16 + i) * 10; // wave
        } else if (reachToCursor && i === (hv!.x > st.x ? 1 : 0)) {
          const dx = hv!.x - shX, dy = hv!.y - shY, d = Math.hypot(dx, dy) || 1;
          const reach = Math.min(armLen * 0.98, d);
          handTX = shX + (dx / d) * reach; handTY = shY + (dy / d) * reach;
        } else {
          handTX = shX + side * armLen * 0.22 + (i === 0 ? -armSwing : armSwing) * 0.4; handTY = shY + armLen * 0.8;
        }
        const arm = st.arms[i];
        if (!st.inited) { arm.x = handTX; arm.y = handTY; }
        arm.x = lerp(arm.x, handTX, Math.min(1, dt * 12));
        arm.y = lerp(arm.y, handTY, Math.min(1, dt * 12));
        const bend = side; // elbow out
        const e = ik2(shX, shY, arm.x, arm.y, armLen * 0.5, armLen * 0.5, bend);
        const path = limbRefs.current[2 + i];
        if (path) path.setAttribute('d', `M${shX.toFixed(1)} ${shY.toFixed(1)} L${e.jx.toFixed(1)} ${e.jy.toFixed(1)} L${arm.x.toFixed(1)} ${arm.y.toFixed(1)}`);
      }
      st.inited = true;

      // ── EYES (on the head) — blink, look, widen (startle), squint (happy), droop (sleepy)
      st.blinkT -= dt;
      if (st.blinkT <= 0) { st.blink = 1; st.blinkT = 2 + Math.random() * 3.5; }
      st.blink = Math.max(0, st.blink - dt * 9); // quick close/open (~110ms)
      const blinkClose = Math.sin(Math.min(1, st.blink) * Math.PI); // 0→1→0
      let openBase = 1;
      if (st.mood === 'happy') openBase = 0.55; // squint
      else if (st.mood === 'sleepy') openBase = 0.35;
      openBase = Math.min(1.35, openBase + st.eyeWide * 0.9); // startle widen
      const open = Math.max(0.06, openBase * (1 - blinkClose));
      st.lid += (open - st.lid) * Math.min(1, dt * 20);
      const pupTX = cursorOn && hv ? Math.max(-3.2, Math.min(3.2, (hv.x - st.x) / 60)) : Math.sin(st.phase * 0.6) * 1.6;
      const pupTY = cursorOn && hv ? Math.max(-2.6, Math.min(2.6, (hv.y - st.y) / 90)) : 0;
      st.pupX = lerp(st.pupX, pupTX, Math.min(1, dt * 8));
      st.pupY = lerp(st.pupY, pupTY, Math.min(1, dt * 8));
      const eyesBox = eyesBoxRef.current;
      const eyeScale = Math.max(0.5, Math.min(2.4, hh / 90));
      if (eyesBox) eyesBox.style.transform = `translate(${rx}px, ${headTopY + hh * 0.44}px) rotate(${st.tilt * 0.6}rad) scale(${eyeScale * face}, ${eyeScale})`;
      for (let i = 0; i < 2; i++) {
        const g = eyeRefs.current[i];
        if (g) g.setAttribute('transform', `translate(${i === 0 ? -13 : 13} 0) scale(1 ${st.lid.toFixed(3)})`);
        const pg = pupRefs.current[i];
        if (pg) pg.setAttribute('transform', `translate(${(st.pupX).toFixed(2)} ${(st.pupY).toFixed(2)})`);
      }

      // ── ambient babble (occasional, quiet)
      if (st.phase - st.babbleAt > 3.4 + Math.random() * 3 && st.mood !== 'sleepy' && st.mood !== 'startled') {
        st.babbleAt = st.phase;
        if (Math.random() < 0.5) fdSfx.babble(Math.floor(st.phase * 7));
      }

      // ── pet coo (throttled) when affection is climbing
      if (st.mood === 'happy' && st.affection > 0.6) puff('heart', 1400);

      // carry the emote bubble above the head
      const bub = bubbleRef.current;
      if (bub) bub.style.transform = `translate(${rx - 20}px, ${headTopY - 16}px)`;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, size.w, size.h, persona]);

  useEffect(() => () => { if (emoteTimer.current) clearTimeout(emoteTimer.current); }, []);

  // pet coo sound when affection crosses up
  const affRef = useRef(0);
  useEffect(() => {
    const iv = setInterval(() => {
      const a = stRef.current.affection;
      if (a > 0.6 && affRef.current <= 0.6) fdSfx.coo();
      affRef.current = a;
    }, 200);
    return () => clearInterval(iv);
  }, []);

  // ── interaction
  const localXY = (e: React.PointerEvent) => {
    const r = arenaRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: React.PointerEvent) => {
    const { x, y } = localXY(e);
    const st = stRef.current;
    const rxg = (parts[1]?.w ?? 90) * 0.8 + 30;
    const onBody = Math.abs(x - st.x) < rxg && Math.abs(y - st.y) < 160;
    if (onBody) { dragRef.current = { startX: x, startY: y, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }
    else setTreat({ x, y });
  };
  const onMove = (e: React.PointerEvent) => {
    const { x, y } = localXY(e);
    const now = performance.now();
    const prev = hoverRef.current;
    const hdt = prev ? Math.max(1, now - prev.t) / 1000 : 0.016;
    hoverRef.current = { x, y, t: now, vx: prev ? (x - prev.x) / hdt : 0, vy: prev ? (y - prev.y) / hdt : 0 };
    const d = dragRef.current;
    if (d) {
      if (Math.hypot(x - d.startX, y - d.startY) > 4) d.moved = true;
      if (d.moved) { const st = stRef.current; st.x = x; st.y = y; st.vx = 0; st.vy = 0; }
    }
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    const st = stRef.current;
    if (d && !d.moved) {
      st.energy = Math.min(1, st.energy + 0.4);
      st.affection = Math.min(1, st.affection + 0.35);
      st.mood = 'happy'; st.moodHold = 0.9; st.hop = 42; st.squashPulse = 0.34;
      st.vx += (Math.random() - 0.5) * 200;
      fdSfx.poke(); puff('heart', 400);
    } else if (d && d.moved) {
      st.mood = 'playful'; st.moodHold = 0.6; st.hop = 22;
      fdSfx.hop(); puff('spark', 600);
    }
  };
  const shake = () => { triggerStartle(3); const st = stRef.current; st.energy = 1; st.vx = (Math.random() - 0.5) * 460; st.vy = (Math.random() - 0.5) * 260; };
  const toggleMute = () => { const m = !fdMuted(); fdSetMuted(m); setMuted(m); if (!m) fdSfx.coo(); };

  return (
    <div
      ref={arenaRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => { hoverRef.current = null; }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--dir-bg)', overflow: 'hidden', touchAction: 'none', cursor: 'grab' }}
    >
      {/* limb layer — behind the trunk so limbs attach from behind, feet/hands show */}
      <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {[0, 1, 2, 3].map((i) => (
          <path
            key={i}
            ref={(el) => { limbRefs.current[i] = el; }}
            fill="none"
            stroke="var(--dir-text-primary)"
            strokeWidth={i < 2 ? 7 : 5.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>

      {parts.map((p, i) => (
        <div
          key={i}
          ref={(el) => { partRefs.current[i] = el; }}
          style={{ position: 'absolute', left: 0, top: 0, width: p.w, height: p.h, transformOrigin: i === 0 ? '50% 100%' : i === 2 ? '50% 0%' : '50% 50%', pointerEvents: 'none', willChange: 'transform' }}
        >
          <StyleScope svgStyle={p.svgStyle} mods={p.mods}>
            <SvgStyleTransform wrapperOverride={{ display: 'block', width: '100%', height: '100%' }}>
              <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: p.markup }} />
            </SvgStyleTransform>
          </StyleScope>
        </div>
      ))}

      {/* expressive eyes — the drawing wakes up */}
      <div ref={eyesBoxRef} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, pointerEvents: 'none', willChange: 'transform' }}>
        <svg width="80" height="52" viewBox="-40 -26 80 52" style={{ position: 'absolute', left: -40, top: -26, overflow: 'visible' }}>
          {[0, 1].map((i) => (
            <g key={i} ref={(el) => { eyeRefs.current[i] = el; }}>
              <ellipse cx="0" cy="0" rx="10.5" ry="12" fill="#fbf8f1" stroke="var(--dir-text-primary)" strokeWidth="2.4" />
              <g ref={(el) => { pupRefs.current[i] = el; }}>
                <circle cx="0" cy="1" r="5" fill="var(--dir-text-primary)" />
                <circle cx="1.8" cy="-1.2" r="1.5" fill="#fbf8f1" />
              </g>
            </g>
          ))}
        </svg>
      </div>

      {emote && (
        <div key={emote.id} ref={bubbleRef} style={{ position: 'absolute', left: 0, top: 0, width: 40, height: 40, color: 'var(--dir-text-primary)', pointerEvents: 'none', animation: 'fd-emote 1.6s cubic-bezier(0.2,0.8,0.3,1) forwards' }}>
          <FdDoodle name={emote.kind} size={40} />
        </div>
      )}

      {treat && (
        <div style={{ position: 'absolute', left: treat.x - 9, top: treat.y - 9, width: 18, height: 18, borderRadius: 999, background: 'var(--dir-text-primary)', pointerEvents: 'none', animation: 'fd-treat 0.9s ease-in-out infinite' }} />
      )}
      <style>{`@keyframes fd-treat{0%,100%{transform:scale(1)}50%{transform:scale(0.7)}}@keyframes fd-emote{0%{opacity:0;transform:scale(0.4)}20%{opacity:1;transform:scale(1.12)}45%{transform:scale(1)}100%{opacity:0;transform:translateY(-28px) scale(0.9)}}`}</style>

      <div style={{ position: 'absolute', top: 18, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', color: 'var(--dir-text-primary)', fontFamily: IS }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.42 }}>It's alive</div>
        <div style={{ fontSize: 13, opacity: 0.5, marginTop: 4 }}>pet it (glide slow) · poke or carry it · toss a treat on empty ground · Shake to spook it</div>
      </div>

      <div style={{ position: 'absolute', bottom: 26, left: 0, right: 0, display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={shake} style={pillStyle(true)}>Shake it!</button>
        <button onClick={toggleMute} style={pillStyle(false)}>{muted ? 'Sound off' : 'Sound on'}</button>
        {onExit && <button onClick={onExit} style={pillStyle(false)}>Back</button>}
      </div>
    </div>
  );
}

function pillStyle(solid: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    border: '1.5px solid var(--dir-text-primary)',
    background: solid ? 'var(--dir-text-primary)' : 'transparent',
    color: solid ? 'var(--dir-bg)' : 'var(--dir-text-primary)',
    fontFamily: IS,
    fontWeight: 600,
    fontSize: 14,
    padding: '10px 22px',
    borderRadius: 999,
    cursor: 'pointer',
    touchAction: 'manipulation',
  };
}
