import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FdDoodle, type DoodleName } from './FdDoodle';
import { IS } from '../../lib/typography';
import { placedStrokes, type FdPanel } from '../../lib/frankendoodle/compose';
import { autoRig, type Rig } from '../../lib/frankendoodle/autoRig';
import { bindSkin, poseNodes, poseStrokes, type Bind } from '../../lib/frankendoodle/rigSkin';
import { fdSfx, fdAudioInit, fdSetMuted, fdMuted } from '../../lib/frankendoodle/fdSound';
import type { StrokePoint } from '../DeskDoodles/DrawSurface';
import type { F3SvgStyle } from '../../state/F3SvgStyleContext';
import type { F3ModifiersState } from '../../state/F3RoughModifiersContext';

// The living creature — the ACTUAL DRAWING, auto-rigged and alive. We extract a
// skeleton from the strokes (autoRig), skin the real linework to it, then a
// procedural brain drives the bones: it roams the screen, walks with a limb
// gait, follows / flees the cursor, and reacts to petting & pokes — deforming
// its own drawn lines. No fake stapled limbs; whatever you drew is what moves.

type Mood = 'idle' | 'curious' | 'playful' | 'happy' | 'startled' | 'sleepy';

interface BoneMeta { depth: number; side: number; vertical: number; }

export function FdPhysics({
  panels,
  configs,
  onExit,
}: {
  panels: FdPanel[];
  configs: { svgStyle: F3SvgStyle; mods: F3ModifiersState }[];
  onExit?: () => void;
}) {
  void configs;
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [treat, setTreat] = useState<{ x: number; y: number } | null>(null);
  const [emote, setEmote] = useState<{ kind: DoodleName; id: number } | null>(null);
  const [muted, setMuted] = useState(false);
  const treatRef = useRef<{ x: number; y: number } | null>(null);
  treatRef.current = treat;
  const hoverRef = useRef<{ x: number; y: number; t: number; vx: number; vy: number } | null>(null);
  const dragRef = useRef<{ moved: boolean } | null>(null);
  const emoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── the rig, skin, and per-bone metadata (once) ──
  const rigData = useMemo(() => {
    const strokes = placedStrokes(panels);
    const rig: Rig = autoRig(strokes);
    const binds: Bind[][] = bindSkin(strokes, rig);
    const root = rig.nodes[rig.root] ?? { x: rig.bbox.x + rig.bbox.w / 2, y: rig.bbox.y + rig.bbox.h / 2 };
    const meta: BoneMeta[] = rig.bones.map((b) => {
      let depth = 0, p = b.parent;
      while (p >= 0 && depth < 20) { depth++; p = rig.bones[p].parent; }
      const a = rig.nodes[b.a], c = rig.nodes[b.b];
      const side = Math.sign((c.x - root.x)) || 1;
      const restAng = Math.atan2(c.y - a.y, c.x - a.x);
      return { depth, side, vertical: Math.abs(Math.sin(restAng)) };
    });
    return { strokes, rig, binds, root, meta, bbox: rig.bbox };
  }, [panels]);

  const persona = useMemo(() => {
    const seed = panels.reduce((a, p) => a + p.strokes.length * 13 + p.strokes.reduce((b, s) => b + s.points.length, 0), 0);
    const r = (n: number) => (Math.sin(seed * 0.017 + n) + 1) / 2;
    return { curiosity: 0.55 + r(1.1) * 0.5, timid: 0.2 + r(2.3) * 0.6, play: 0.4 + r(3.7) * 0.6, speed: 0.8 + r(5) * 0.55 };
  }, [panels]);

  const st = useRef({
    x: 0, y: 0, vx: 0, vy: 0, walk: 0, phase: 0, face: 1, hop: 0, squash: 0,
    mood: 'curious' as Mood, energy: 0.6, affection: 0, moodHold: 0, startle: 0, startleCool: 0,
    wx: 0, wy: 0, wanderT: 0, arcSign: 1, emoteAt: -9999, nearT: 0, inited: false,
  });

  useEffect(() => { fdAudioInit(); }, []);

  useLayoutEffect(() => {
    const el = arenaRef.current;
    if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setSize((p) => (Math.abs(p.w - r.width) < 1 && Math.abs(p.h - r.height) < 1 ? p : { w: r.width, h: r.height })); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const puff = (kind: DoodleName, gap = 1500) => {
    const s = st.current, now = performance.now();
    if (now - s.emoteAt < gap) return;
    s.emoteAt = now;
    setEmote({ kind, id: Math.round(now) });
    if (emoteTimer.current) clearTimeout(emoteTimer.current);
    emoteTimer.current = setTimeout(() => setEmote(null), 1600);
  };

  // creature screen scale
  const scale = useMemo(() => Math.min(300 / rigData.bbox.h, (size.w * 0.4) / rigData.bbox.w), [rigData, size.w]);

  useEffect(() => {
    const { rig, binds, strokes, root } = rigData;
    if (!rig.bones.length) return;
    const s = st.current;
    (window as unknown as { __creature?: unknown }).__creature = s;
    if (!s.inited) { s.x = size.w / 2; s.y = size.h * 0.5; s.inited = true; }
    let raf = 0, alive = true, last = performance.now();
    const bodyR = rigData.bbox.w * scale * 0.42 + 30;

    const tick = () => {
      if (!alive) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      s.phase += dt;
      s.energy = Math.max(0.05, s.energy - dt * 0.03);
      s.moodHold -= dt; s.startleCool -= dt; s.startle = Math.max(0, s.startle - dt * 2.2);
      s.affection = Math.max(0, s.affection - dt * 0.25);

      const hv = hoverRef.current;
      const cursorOn = !!hv && now - hv.t < 1500;
      const dragging = !!dragRef.current && dragRef.current.moved;
      const treatPt = treatRef.current;
      const dCur = cursorOn && hv ? Math.hypot(hv.x - s.x, hv.y - s.y) : Infinity;
      const cSpeed = hv ? Math.hypot(hv.vx, hv.vy) : 0;

      // petting
      if (cursorOn && dCur < bodyR + 30 && cSpeed < 520 && !dragging && s.startle <= 0) { s.affection = Math.min(1, s.affection + dt * 1.3); s.energy = Math.min(1, s.energy + dt * 0.25); }
      // startle (fast close swipe)
      if (cursorOn && dCur < 200) s.nearT += dt; else s.nearT = 0;
      if (cursorOn && cSpeed > 2200 && dCur < 150 && s.nearT > 0.08 && s.startleCool <= 0) { s.startle = 1; s.startleCool = 1.5; s.mood = 'startled'; s.moodHold = 0.7; s.hop = 26; fdSfx.startle(); puff('excl', 600); }

      if (s.moodHold <= 0 && !dragging && s.startle <= 0) {
        if (treatPt) s.mood = 'playful';
        else if (s.affection > 0.55) { s.mood = 'happy'; puff('heart', 1300); }
        else if (cursorOn && dCur < 340) { s.mood = s.energy > 0.45 ? 'playful' : 'curious'; puff(s.energy > 0.45 ? 'spark' : 'question', 2600); }
        else if (s.energy < 0.14) { s.mood = 'sleepy'; puff('zzz', 2600); }
        else s.mood = 'idle';
        s.moodHold = 0.3;
      }

      // goal + speed
      let tx = s.x, ty = s.y, speedWant = 0;
      if (treatPt) { tx = treatPt.x; ty = treatPt.y; speedWant = 220 * persona.speed; if (Math.hypot(tx - s.x, ty - s.y) < 40) { setTreat(null); s.energy = Math.min(1, s.energy + 0.4); s.hop = 26; s.mood = 'happy'; s.moodHold = 0.7; fdSfx.munch(); puff('heart', 400); } }
      else if (s.startle > 0.2 && hv) { const dx = s.x - hv.x, dy = s.y - hv.y, d = Math.hypot(dx, dy) || 1; tx = s.x + (dx / d) * 300; ty = s.y + (dy / d) * 300; speedWant = 300 * (0.7 + persona.timid); }
      else if ((s.mood === 'curious' || s.mood === 'playful') && hv) { const dx = hv.x - s.x, dy = hv.y - s.y, d = Math.hypot(dx, dy) || 1; const want = s.mood === 'playful' ? 70 : 108; tx = hv.x - (dx / d) * want; ty = hv.y - (dy / d) * want; speedWant = (s.mood === 'playful' ? 175 : 118) * persona.curiosity; }
      else if (s.mood === 'happy' || s.mood === 'sleepy') speedWant = 0;
      else { if (s.phase > s.wanderT || Math.hypot(s.wx - s.x, s.wy - s.y) < 60) { s.wanderT = s.phase + 1.8 + Math.random() * 2.2; s.wx = Math.max(90, Math.min(size.w - 90, s.x < size.w / 2 ? size.w * (0.55 + Math.random() * 0.4) : size.w * (0.05 + Math.random() * 0.4))); s.wy = size.h * 0.32 + Math.random() * Math.max(1, size.h * 0.4); s.arcSign = Math.random() < 0.5 ? -1 : 1; } tx = s.wx; ty = s.wy; speedWant = 128 * persona.speed; }

      // locomote
      if (!dragging) {
        let dx = tx - s.x, dy = ty - s.y; const dist = Math.hypot(dx, dy);
        if (dist > 5 && speedWant > 0) { const px = -dy / dist, py = dx / dist; const arc = s.arcSign * Math.min(0.5, dist / 900) * (s.startle > 0.2 ? 0 : 1); dx += px * dist * arc; dy += py * dist * arc; const dd = Math.hypot(dx, dy) || 1; const ease = Math.min(1, dist / 55); const k = Math.min(1, dt * (s.startle > 0.2 ? 8 : 4.5)); s.vx += ((dx / dd) * speedWant * ease - s.vx) * k; s.vy += ((dy / dd) * speedWant * ease - s.vy) * k; }
        else { s.vx *= 0.85; s.vy *= 0.85; }
        const sp = Math.hypot(s.vx, s.vy); if (sp > 360) { s.vx = (s.vx / sp) * 360; s.vy = (s.vy / sp) * 360; }
        s.x += s.vx * dt; s.y += s.vy * dt;
        const m = 60, topM = m, botM = m + 40;
        if (s.x < m) { s.x = m; s.vx = Math.abs(s.vx) * 0.45; } else if (s.x > size.w - m) { s.x = size.w - m; s.vx = -Math.abs(s.vx) * 0.45; }
        if (s.y < topM) { s.y = topM; s.vy = Math.abs(s.vy) * 0.45; } else if (s.y > size.h - botM) { s.y = size.h - botM; s.vy = -Math.abs(s.vy) * 0.45; }
      }

      const speed = Math.hypot(s.vx, s.vy);
      const moving = speed > 16;
      s.walk += (moving ? speed * dt * 0.02 : dt * 0.5);
      if (Math.abs(s.vx) > 16) s.face = s.vx > 0 ? 1 : -1;
      s.hop *= 0.86;
      const breathe = Math.sin(s.phase * 2.1) * (0.02 + s.energy * 0.012);
      const sq = 1 + s.hop * 0.004 + breathe - s.squash;
      s.squash *= 0.85;

      // ── per-bone rotation: gait + breathe + startle flail (generic, any morphology) ──
      const rot = rig.bones.map((_, i) => {
        const mt = rigData.meta[i];
        const gaitAmp = (0.05 + speed * 0.0016) * (0.35 + mt.depth * 0.45) * (0.45 + mt.vertical * 0.9);
        const gait = Math.sin(s.walk * Math.PI * 2 + (mt.side > 0 ? 0 : Math.PI) + mt.depth * 0.6) * gaitAmp;
        const idle = Math.sin(s.phase * 1.7 + i * 1.3) * (0.02 + mt.depth * 0.02);
        const flail = s.startle * Math.sin(s.phase * 24 + i * 2.1) * (0.25 + mt.depth * 0.25);
        const happy = s.mood === 'happy' ? Math.sin(s.phase * 12 + i) * 0.08 : 0;
        return gait + idle + flail + happy;
      });
      const posed = poseNodes(rig, rot);
      const ps = poseStrokes(strokes, binds, rig, posed);

      // map drawing space → screen (root at s.x,s.y; face flip; squash; hop)
      const hs = 1 / Math.sqrt(Math.max(0.5, sq));
      const bob = Math.sin(s.walk * Math.PI * 2) * Math.min(6, speed * 0.02);
      const cx = s.x, cy = s.y - s.hop + bob;
      const d = pointsToPath(ps, root, cx, cy, scale * hs * s.face, scale * sq);
      if (pathRef.current) pathRef.current.setAttribute('d', d);

      // ambient + coo
      const bub = bubbleRef.current;
      if (bub) bub.style.transform = `translate(${cx - 20}px, ${cy - rigData.bbox.h * scale * 0.62 - 16}px)`;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rigData, size.w, size.h, persona, scale]);

  useEffect(() => () => { if (emoteTimer.current) clearTimeout(emoteTimer.current); }, []);
  const affRef = useRef(0);
  useEffect(() => { const iv = setInterval(() => { const a = st.current.affection; if (a > 0.6 && affRef.current <= 0.6) fdSfx.coo(); affRef.current = a; }, 200); return () => clearInterval(iv); }, []);

  // ── interaction ──
  const localXY = (e: React.PointerEvent) => { const r = arenaRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onDown = (e: React.PointerEvent) => {
    const { x, y } = localXY(e); const s = st.current;
    const rx = rigData.bbox.w * scale * 0.5 + 30, ry = rigData.bbox.h * scale * 0.55 + 20;
    if (Math.abs(x - s.x) < rx && Math.abs(y - s.y) < ry) { dragRef.current = { moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }
    else setTreat({ x, y });
  };
  const onMove = (e: React.PointerEvent) => {
    const { x, y } = localXY(e); const now = performance.now(); const prev = hoverRef.current; const hdt = prev ? Math.max(1, now - prev.t) / 1000 : 0.016;
    hoverRef.current = { x, y, t: now, vx: prev ? (x - prev.x) / hdt : 0, vy: prev ? (y - prev.y) / hdt : 0 };
    const dr = dragRef.current; if (dr) { dr.moved = true; const s = st.current; s.x = x; s.y = y; s.vx = 0; s.vy = 0; }
  };
  const onUp = () => {
    const dr = dragRef.current; dragRef.current = null; const s = st.current;
    if (dr && !dr.moved) { s.energy = Math.min(1, s.energy + 0.4); s.affection = Math.min(1, s.affection + 0.35); s.mood = 'happy'; s.moodHold = 0.9; s.hop = 34; s.squash = 0.14; fdSfx.poke(); puff('heart', 400); }
    else if (dr && dr.moved) { s.mood = 'playful'; s.moodHold = 0.5; s.hop = 18; fdSfx.hop(); puff('spark', 600); }
  };
  const shake = () => { const s = st.current; s.startle = 1; s.startleCool = 1.5; s.mood = 'startled'; s.moodHold = 1; s.hop = 24; s.vx = (Math.random() - 0.5) * 460; s.vy = (Math.random() - 0.5) * 260; fdSfx.startle(); puff('excl', 300); };
  const toggleMute = () => { const mm = !fdMuted(); fdSetMuted(mm); setMuted(mm); if (!mm) fdSfx.coo(); };

  return (
    <div ref={arenaRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hoverRef.current = null; }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--dir-bg)', overflow: 'hidden', touchAction: 'none', cursor: 'grab' }}>
      <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <path ref={pathRef} fill="none" stroke="var(--dir-text-primary)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {emote && (
        <div key={emote.id} ref={bubbleRef} style={{ position: 'absolute', left: 0, top: 0, width: 40, height: 40, color: 'var(--dir-text-primary)', pointerEvents: 'none', animation: 'fd-emote 1.6s cubic-bezier(0.2,0.8,0.3,1) forwards' }}>
          <FdDoodle name={emote.kind} size={40} />
        </div>
      )}
      {treat && <div style={{ position: 'absolute', left: treat.x - 9, top: treat.y - 9, width: 18, height: 18, borderRadius: 999, background: 'var(--dir-text-primary)', pointerEvents: 'none', animation: 'fd-treat 0.9s ease-in-out infinite' }} />}
      <style>{`@keyframes fd-treat{0%,100%{transform:scale(1)}50%{transform:scale(0.7)}}@keyframes fd-emote{0%{opacity:0;transform:scale(0.4)}20%{opacity:1;transform:scale(1.1)}45%{transform:scale(1)}100%{opacity:0;transform:translateY(-26px) scale(0.9)}}`}</style>

      <div style={{ position: 'absolute', top: 18, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', color: 'var(--dir-text-primary)', fontFamily: IS }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.42 }}>It's alive</div>
        <div style={{ fontSize: 13, opacity: 0.5, marginTop: 4 }}>your drawing, rigged from its own lines · pet it · poke or carry it · toss a treat</div>
      </div>
      <div style={{ position: 'absolute', bottom: 26, left: 0, right: 0, display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={shake} style={pillStyle(true)}>Shake it!</button>
        <button onClick={toggleMute} style={pillStyle(false)}>{muted ? 'Sound off' : 'Sound on'}</button>
        {onExit && <button onClick={onExit} style={pillStyle(false)}>Back</button>}
      </div>
    </div>
  );
}

// posed strokes (drawing space) → one SVG path string, placed at (cx,cy) with
// the rig root as the anchor, scaled and face-flipped.
function pointsToPath(strokes: StrokePoint[][], root: { x: number; y: number }, cx: number, cy: number, sx: number, sy: number): string {
  return strokes
    .map((s) => s.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(cx + (x - root.x) * sx).toFixed(1)} ${(cy + (y - root.y) * sy).toFixed(1)}`).join(' '))
    .join(' ');
}

function pillStyle(solid: boolean): React.CSSProperties {
  return { appearance: 'none', border: '1.5px solid var(--dir-text-primary)', background: solid ? 'var(--dir-text-primary)' : 'transparent', color: solid ? 'var(--dir-bg)' : 'var(--dir-text-primary)', fontFamily: IS, fontWeight: 600, fontSize: 14, padding: '10px 22px', borderRadius: 999, cursor: 'pointer', touchAction: 'manipulation' };
}
