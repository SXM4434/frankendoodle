// Frankendoodle — procedural creature sound. All synthesized with the Web
// Audio API (no asset files): little coos, pops, boings and footsteps that make
// every interaction LAND. Muted until the player brings the creature to life
// (a real user gesture), which satisfies browser autoplay policy.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function fdAudioInit() {
  ac();
}
export function fdSetMuted(m: boolean) {
  muted = m;
}
export function fdMuted() {
  return muted;
}

interface Tone {
  freq: number;
  freq2?: number; // glide target
  dur: number;
  type?: OscillatorType;
  vol?: number;
  delay?: number;
  slide?: number; // portion of dur to glide over
}

function tone({ freq, freq2, dur, type = 'sine', vol = 0.18, delay = 0, slide }: Tone) {
  const c = ac();
  if (!c || !master || muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freq2 != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t + dur * (slide ?? 1));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
}

// a soft filtered-noise thump for footsteps / landings
function thump(vol = 0.12, freq = 90) {
  const c = ac();
  if (!c || !master || muted) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.09);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.12);
}

export const fdSfx = {
  step: () => thump(0.05, 78),
  hop: () => tone({ freq: 280, freq2: 680, dur: 0.19, type: 'sine', vol: 0.16, slide: 0.85 }), // boing up
  land: () => thump(0.13, 150),
  poke: () => tone({ freq: 480, freq2: 900, dur: 0.09, type: 'square', vol: 0.12, slide: 0.7 }), // pop
  coo: () => {
    tone({ freq: 430, dur: 0.13, type: 'triangle', vol: 0.13 });
    tone({ freq: 650, dur: 0.17, type: 'triangle', vol: 0.12, delay: 0.09 });
  },
  startle: () => tone({ freq: 920, freq2: 260, dur: 0.17, type: 'sawtooth', vol: 0.13, slide: 0.9 }), // squeak down
  munch: () => {
    tone({ freq: 150, dur: 0.05, type: 'square', vol: 0.11 });
    tone({ freq: 110, dur: 0.06, type: 'square', vol: 0.11, delay: 0.06 });
  },
  babble: (seed = 0) => tone({ freq: 360 + ((seed * 53) % 200), freq2: 300 + ((seed * 31) % 160), dur: 0.1, type: 'triangle', vol: 0.06, slide: 0.8 }),
  blink: () => tone({ freq: 1200, dur: 0.015, type: 'sine', vol: 0.02 }),
};
