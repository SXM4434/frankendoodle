import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SvgStyleTransform } from '../canvas/SvgStyleTransform';
import { StyleScope } from './StyleScope';
import { FdDoodle, type DoodleName } from './FdDoodle';
import { IS } from '../../lib/typography';
import { pieceMarkup, panelLayout, type FdPanel } from '../../lib/frankendoodle/compose';
import type { F3SvgStyle } from '../../state/F3SvgStyleContext';
import type { F3ModifiersState } from '../../state/F3RoughModifiersContext';

// The living creature — a PROCEDURAL character rig (not a rigid-body solver, so
// it never seizures). Head → torso → legs are articulated segments with neck +
// waist joints. An AI brain gives it a mood, energy and a personality DERIVED
// from how it was drawn; it roams the whole screen and reacts to you.
//
// Built on Disney's 12 principles of animation (naturalistic-motion recipe):
//   • it is NEVER truly still — always breathing + shifting weight (life = motion)
//   • squash & stretch, volume-preserving, on hops/landings/startles
//   • anticipation: a small counter-crouch before it launches
//   • follow-through / overlap: head + legs lag the torso, no twinning
//   • arcs: it curves toward goals instead of tracking in straight lines
//   • slow-in / slow-out easing on every pose channel
//   • secondary action + emotive bubbles (its face is YOUR drawing, so emotion
//     reads through body acting + a heart / ! / ? / zzz bubble, not fake eyes)

interface Part {
  markup: string;
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  w: number;
  h: number;
}

type Mood = 'idle' | 'curious' | 'playful' | 'happy' | 'startled' | 'sleepy';

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
  const [size, setSize] = useState<{ w: number; h: number }>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [parts, setParts] = useState<Part[]>([]);
  const [treat, setTreat] = useState<{ x: number; y: number } | null>(null);
  const [emote, setEmote] = useState<{ kind: DoodleName; id: number } | null>(null);
  const treatRef = useRef<{ x: number; y: number } | null>(null);
  treatRef.current = treat;
  const hoverRef = useRef<{ x: number; y: number; t: number; vx: number; vy: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const emoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stRef = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    walk: 0,
    face: 1,
    lean: 0,
    hop: 0,
    prevHop: 0,
    squashPulse: 0,
    tilt: 0,
    idleLook: 0,
    mood: 'curious' as Mood,
    energy: 0.6,
    affection: 0,
    moodHold: 0,
    startleCool: 0,
    wx: 0,
    wy: 0,
    wanderT: 0,
    arcSign: 1,
    phase: 0,
    emoteAt: -9999,
    bubbleY: 0,
  });

  // Personality is DERIVED FROM HOW THE CREATURE WAS DRAWN — more strokes/points
  // read as busier/bolder. Exaggerated into four traits (character-appeal skill).
  const persona = useMemo(() => {
    const seed = panels.reduce((a, p) => a + p.strokes.length * 13 + p.strokes.reduce((b, s) => b + s.points.length, 0), 0);
    const r = (n: number) => (Math.sin(seed * 0.017 + n) + 1) / 2;
    return {
      curiosity: 0.55 + r(1.1) * 0.5, // how strongly it approaches the cursor
      timid: 0.2 + r(2.3) * 0.65, // how far/fast it flees a scare
      play: 0.4 + r(3.7) * 0.6, // bounciness
      speed: 0.8 + r(5) * 0.55, // base tempo
    };
  }, [panels]);

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

  // build the rig segments (head / torso / legs), capped to a walking size
  useEffect(() => {
    const { boxes, viewBox } = panelLayout(panels);
    const scale = Math.min(280 / viewBox.h, (size.w * 0.42) / viewBox.w);
    setParts(
      panels.map((p, i) => ({
        markup: pieceMarkup(p),
        svgStyle: configs[i]?.svgStyle ?? p.svgStyle,
        mods: configs[i]?.mods ?? p.mods,
        w: Math.max(24, boxes[i].w * scale + 18),
        h: Math.max(24, boxes[i].h * scale + 18),
      })),
    );
    if (stRef.current.x === 0) {
      stRef.current.x = size.w / 2;
      stRef.current.y = size.h / 2;
    }
  }, [panels, configs, size.w, size.h]);

  // throttled emotive bubble
  const puff = (kind: DoodleName, gap = 1500) => {
    const st = stRef.current;
    const now = performance.now();
    if (now - st.emoteAt < gap) return;
    st.emoteAt = now;
    setEmote({ kind, id: Math.round(now) });
    if (emoteTimer.current) clearTimeout(emoteTimer.current);
    emoteTimer.current = setTimeout(() => setEmote(null), 1500);
  };

  // the AI brain + procedural animation loop
  useEffect(() => {
    if (parts.length < 1) return;
    let raf = 0;
    let alive = true;
    let last = performance.now();
    const st = stRef.current;
    (window as unknown as { __creature?: unknown }).__creature = st; // deterministic-playtest hook
    if (st.x === 0) {
      st.x = size.w / 2;
      st.y = size.h / 2;
    }
    const th = parts[1]?.h ?? parts[0].h;
    const hh = parts[0].h;
    const bodyR = (parts[1]?.w ?? 90) * 0.7 + 26;

    const setMood = (m: Mood, hold: number) => {
      st.mood = m;
      st.moodHold = hold;
    };

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
      const nearBody = dCur < bodyR + 30;

      // ── PETTING: a slow cursor gliding over the body soothes it (interactive
      // affection). A genuinely FAST close swipe is the only thing that spooks it.
      if (cursorOn && nearBody && cSpeed < 520 && !dragging) {
        st.affection = Math.min(1, st.affection + dt * 1.3);
        st.energy = Math.min(1, st.energy + dt * 0.25);
      }

      // ── DECIDE mood (hysteresis: a locked mood holds so it can't flip-flop → no spazz)
      if (st.moodHold <= 0 && !dragging) {
        if (treatPt) setMood('playful', 0.25);
        else if (cursorOn && cSpeed > 2300 && dCur < 100 && st.startleCool <= 0) {
          setMood('startled', 0.7);
          st.startleCool = 1.6;
          st.hop = 30 * (0.6 + persona.timid);
          st.squashPulse = 0.3;
          puff('excl', 900);
        } else if (st.affection > 0.55) {
          setMood('happy', 0.4);
          puff('heart', 1300);
        } else if (cursorOn && dCur < 340) {
          const m: Mood = st.energy > 0.45 ? 'playful' : 'curious';
          setMood(m, 0.3);
          puff(m === 'curious' ? 'question' : 'spark', 2600);
        } else if (st.energy < 0.14) {
          setMood('sleepy', 0.6);
          puff('zzz', 2600);
        } else setMood('idle', 0.4);
      }

      // ── pick a goal + how fast to head there
      let tx = st.x;
      let ty = st.y;
      let speedWant = 0;
      if (treatPt) {
        tx = treatPt.x;
        ty = treatPt.y;
        speedWant = 230 * persona.speed;
        if (Math.hypot(tx - st.x, ty - st.y) < 36) {
          setTreat(null);
          st.energy = Math.min(1, st.energy + 0.45);
          st.hop = 34;
          st.squashPulse = 0.32;
          setMood('happy', 0.7);
          puff('heart', 500);
        }
      } else if (st.mood === 'startled' && hv) {
        const dx = st.x - hv.x;
        const dy = st.y - hv.y;
        const d = Math.hypot(dx, dy) || 1;
        tx = st.x + (dx / d) * 300;
        ty = st.y + (dy / d) * 300;
        speedWant = 300 * (0.7 + persona.timid);
      } else if ((st.mood === 'curious' || st.mood === 'playful') && hv) {
        // come toward you, but keep a little personal space so it doesn't smother the cursor
        const dx = hv.x - st.x;
        const dy = hv.y - st.y;
        const d = Math.hypot(dx, dy) || 1;
        const want = st.mood === 'playful' ? 60 : 96; // stand-off distance
        tx = hv.x - (dx / d) * want;
        ty = hv.y - (dy / d) * want;
        speedWant = (st.mood === 'playful' ? 185 : 120) * persona.curiosity;
      } else if (st.mood === 'happy') {
        speedWant = 0; // wiggle in place
      } else if (st.mood === 'sleepy') {
        speedWant = 0;
      } else {
        // idle → purposeful wander that actually crosses the whole screen. Aim
        // for far points (biased away from where it is) so it commits to a trip.
        if (st.phase > st.wanderT || Math.hypot(st.wx - st.x, st.wy - st.y) < 60) {
          st.wanderT = st.phase + 1.8 + Math.random() * 2.2;
          const farX = st.x < size.w / 2 ? size.w * (0.55 + Math.random() * 0.4) : size.w * (0.05 + Math.random() * 0.4);
          st.wx = Math.max(70, Math.min(size.w - 70, farX));
          st.wy = 120 + Math.random() * Math.max(1, size.h - 250);
          st.arcSign = Math.random() < 0.5 ? -1 : 1;
        }
        tx = st.wx;
        ty = st.wy;
        speedWant = 138 * persona.speed;
      }

      // ── LOCOMOTE — steer velocity toward the goal along an ARC, then integrate
      if (!dragging) {
        let dx = tx - st.x;
        let dy = ty - st.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 5 && speedWant > 0) {
          // arc: bias the heading sideways, fading as it arrives (organic curved path)
          const perpX = -dy / dist;
          const perpY = dx / dist;
          const arc = st.arcSign * Math.min(0.5, dist / 900) * (st.mood === 'startled' ? 0 : 1);
          dx += perpX * dist * arc;
          dy += perpY * dist * arc;
          const dd = Math.hypot(dx, dy) || 1;
          const ease = Math.min(1, dist / 55); // slow-in as it arrives
          const dvx = (dx / dd) * speedWant * ease;
          const dvy = (dy / dd) * speedWant * ease;
          const k = Math.min(1, dt * (st.mood === 'startled' ? 8 : 4.5));
          st.vx += (dvx - st.vx) * k;
          st.vy += (dvy - st.vy) * k;
        } else {
          st.vx *= 0.85;
          st.vy *= 0.85;
        }
        // clamp so nothing ever explodes
        const sp = Math.hypot(st.vx, st.vy);
        const cap = 360;
        if (sp > cap) {
          st.vx = (st.vx / sp) * cap;
          st.vy = (st.vy / sp) * cap;
        }
        st.x += st.vx * dt;
        st.y += st.vy * dt;
        // soft bounce off the screen edges
        const m = 46;
        const topM = m + 40;
        const botM = m + 74;
        if (st.x < m) {
          st.x = m;
          st.vx = Math.abs(st.vx) * 0.45;
        } else if (st.x > size.w - m) {
          st.x = size.w - m;
          st.vx = -Math.abs(st.vx) * 0.45;
        }
        if (st.y < topM) {
          st.y = topM;
          st.vy = Math.abs(st.vy) * 0.45;
        } else if (st.y > size.h - botM) {
          st.y = size.h - botM;
          st.vy = -Math.abs(st.vy) * 0.45;
        }
      }

      // ── POSE the rig (procedural, layered — secondary action + overlap + squash)
      const speed = Math.hypot(st.vx, st.vy);
      st.walk += speed * dt * 0.032 + dt * (st.mood === 'sleepy' ? 0.35 : 0.8);
      if (Math.abs(st.vx) > 16) st.face = st.vx > 0 ? 1 : -1;

      // lean into the direction of travel (banked like a runner)
      const leanTarget = Math.max(-0.24, Math.min(0.24, st.vx * 0.001));
      st.lean += (leanTarget - st.lean) * Math.min(1, dt * 5);

      st.hop *= 0.85;
      const wiggle = st.mood === 'happy' ? Math.sin(st.phase * 16) * 0.09 : 0;

      // head look: track the cursor, else a slow idle glance (micro-saccade stand-in)
      st.idleLook += (Math.sin(st.phase * 0.6) * 0.16 - st.idleLook) * Math.min(1, dt * 2);
      const lookTarget = cursorOn && hv ? Math.max(-0.42, Math.min(0.42, (hv.x - st.x) / 190)) : st.idleLook;
      st.tilt += (lookTarget + wiggle - st.tilt) * Math.min(1, dt * 6);

      // squash & stretch (volume-preserving): stretch airborne, squash pulse on land, breathe always
      if (st.prevHop > 8 && st.hop <= 8) st.squashPulse = Math.max(st.squashPulse, 0.32);
      st.prevHop = st.hop;
      st.squashPulse *= 0.82;
      const breath = Math.sin(st.phase * 2.1) * (0.02 + st.energy * 0.015);
      const startleSquash = st.mood === 'startled' ? 0.1 : 0;
      const sqRaw = 1 + st.hop * 0.005 + breath - st.squashPulse - startleSquash;
      const sq = Math.max(0.62, Math.min(1.45, sqRaw)); // vertical scale
      const hs = 1 / Math.sqrt(sq); // horizontal (keeps volume)

      const bob = Math.sin(st.walk * 2) * Math.min(11, 3 + speed * 0.03) * (0.5 + st.energy * 0.6);
      const torsoY = st.y + bob - st.hop;

      // torso — the anchor
      const torsoEl = partRefs.current[1];
      const tw = parts[1]?.w ?? 0;
      if (torsoEl) torsoEl.style.transform = `translate(${st.x - tw / 2}px, ${torsoY - th / 2}px) rotate(${st.lean}rad) scale(${hs * st.face}, ${sq})`;

      // head — sits on the neck, LAGS the torso bob (overlapping action), pivots to look
      const headEl = partRefs.current[0];
      const hw = parts[0].w;
      const headLag = Math.sin(st.walk * 2 - 0.7) * 2.5; // trails the torso
      const neckY = torsoY - th * 0.42 * sq;
      if (headEl) headEl.style.transform = `translate(${st.x - hw / 2 + st.lean * 22}px, ${neckY - hh + breath * 40 + headLag}px) rotate(${st.tilt + st.lean * 0.5}rad) scale(${hs * st.face}, ${sq})`;

      // legs — hang off the waist, sway offset from the torso (no twinning)
      const legsEl = partRefs.current[2];
      const lw = parts[2]?.w ?? 0;
      const legSway = Math.sin(st.walk + 0.5) * (0.11 + Math.min(0.22, speed * 0.001));
      const waistY = torsoY + th * 0.4 * sq;
      if (legsEl) legsEl.style.transform = `translate(${st.x - lw / 2}px, ${waistY}px) rotate(${legSway + st.lean}rad) scale(${hs * st.face}, ${sq})`;

      // carry the emote bubble above the head
      const bub = bubbleRef.current;
      if (bub) bub.style.transform = `translate(${st.x - 20}px, ${neckY - hh - 14}px)`;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, size.w, size.h, persona]);

  useEffect(() => () => { if (emoteTimer.current) clearTimeout(emoteTimer.current); }, []);

  // ── interaction
  const localXY = (e: React.PointerEvent) => {
    const r = arenaRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: React.PointerEvent) => {
    const { x, y } = localXY(e);
    const st = stRef.current;
    const rx = (parts[1]?.w ?? 90) * 0.75 + 26;
    const onBody = Math.abs(x - st.x) < rx && Math.abs(y - st.y) < 150;
    if (onBody) {
      dragRef.current = { startX: x, startY: y, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      setTreat({ x, y }); // toss a treat onto empty ground
    }
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
      if (d.moved) {
        const st = stRef.current;
        st.x = x;
        st.y = y;
        st.vx = 0;
        st.vy = 0;
      }
    }
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    const st = stRef.current;
    if (d && !d.moved) {
      // a tap = a poke — it perks up, anticipates, then hops with a squash-pop
      st.energy = Math.min(1, st.energy + 0.4);
      st.affection = Math.min(1, st.affection + 0.35);
      st.mood = 'happy';
      st.moodHold = 0.9;
      st.hop = 44;
      st.squashPulse = 0.34;
      st.vx += (Math.random() - 0.5) * 200;
      puff('heart', 400);
    } else if (d && d.moved) {
      // just set it down — a happy little wheee
      st.mood = 'playful';
      st.moodHold = 0.6;
      st.hop = 24;
      puff('spark', 600);
    }
  };
  const shake = () => {
    const st = stRef.current;
    st.energy = 1;
    st.mood = 'startled';
    st.moodHold = 1.2;
    st.startleCool = 1.6;
    st.hop = 30;
    st.squashPulse = 0.3;
    st.vx = (Math.random() - 0.5) * 480;
    st.vy = (Math.random() - 0.5) * 300;
    puff('excl', 300);
  };

  return (
    <div
      ref={arenaRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => {
        hoverRef.current = null;
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--dir-bg)', overflow: 'hidden', touchAction: 'none', cursor: 'grab' }}
    >
      {parts.map((p, i) => (
        <div
          key={i}
          ref={(el) => {
            partRefs.current[i] = el;
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: p.w,
            height: p.h,
            transformOrigin: i === 0 ? '50% 100%' : i === 2 ? '50% 0%' : '50% 50%',
            pointerEvents: 'none',
            willChange: 'transform',
          }}
        >
          <StyleScope svgStyle={p.svgStyle} mods={p.mods}>
            <SvgStyleTransform wrapperOverride={{ display: 'block', width: '100%', height: '100%' }}>
              <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: p.markup }} />
            </SvgStyleTransform>
          </StyleScope>
        </div>
      ))}

      {emote && (
        <div
          key={emote.id}
          ref={bubbleRef}
          style={{ position: 'absolute', left: 0, top: 0, width: 40, height: 40, color: 'var(--dir-text-primary)', pointerEvents: 'none', animation: 'fd-emote 1.5s cubic-bezier(0.2,0.8,0.3,1) forwards' }}
        >
          <FdDoodle name={emote.kind} size={40} engine={false} />
        </div>
      )}

      {treat && (
        <div
          style={{
            position: 'absolute',
            left: treat.x - 9,
            top: treat.y - 9,
            width: 18,
            height: 18,
            borderRadius: 999,
            background: 'var(--dir-text-primary)',
            pointerEvents: 'none',
            animation: 'fd-treat 0.9s ease-in-out infinite',
          }}
        />
      )}
      <style>{`@keyframes fd-treat{0%,100%{transform:scale(1)}50%{transform:scale(0.7)}}@keyframes fd-emote{0%{opacity:0;transform:scale(0.4)}20%{opacity:1;transform:scale(1.1)}45%{transform:scale(1)}100%{opacity:0;transform:translateY(-26px) scale(0.9)}}`}</style>

      <div style={{ position: 'absolute', top: 18, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', color: 'var(--dir-text-primary)', fontFamily: IS }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.4 }}>It's alive</div>
        <div style={{ fontSize: 13, opacity: 0.5, marginTop: 4 }}>glide slowly over it to pet · poke or carry it · tap empty space to toss a treat</div>
      </div>

      <div style={{ position: 'absolute', bottom: 26, left: 0, right: 0, display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={shake} style={pillStyle(true)}>
          Shake it!
        </button>
        {onExit && (
          <button onClick={onExit} style={pillStyle(false)}>
            ← Back
          </button>
        )}
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
