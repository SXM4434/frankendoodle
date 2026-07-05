// Frankendoodle — the shared 2-player room.
//
// Networking is Supabase Realtime **Broadcast** (+ Presence). No table, no
// RLS, no deploy — it rides the anon key already baked into supabase.ts, so
// it works the moment the app is hosted anywhere.
//
// Model: strictly turn-based exquisite corpse, so there are never concurrent
// writes. Whole game state is broadcast on every change; peers adopt any
// state that is >= their own panel count (progress is monotonic). A fresh
// joiner asks for state on connect and the peer replies.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabase';
import type { Stroke } from '../../components/DeskDoodles/DrawSurface';
import type { FdPanel, PieceStyle } from './compose';

export type FdPhase = 'lobby' | 'drawing' | 'reveal';

export interface FdState {
  /** monotonic revision — the merge tiebreaker (also lets "restart" win) */
  rev: number;
  panels: FdPanel[];
}

export const TOTAL_PANELS = 3;
export const PANEL_LABELS = ['the head', 'the body', 'the legs & feet'];
export const PANEL_HINTS = [
  'Give your creature a face. No peeking at what comes next!',
  'Connect to the neck stubs and build the body.',
  'Finish the legs — then you both see what you made.',
];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O ambiguity

export function makeRoomCode(seed: number): string {
  // Deterministic-ish from a passed seed (Math.random is fine in the app;
  // the workflow sandbox forbids it but this runs in the browser).
  let n = Math.floor(seed);
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[n % CODE_ALPHABET.length];
    n = Math.floor(n / CODE_ALPHABET.length) + ((i + 1) * 7919);
  }
  return out;
}

interface PeerInfo {
  index: 0 | 1;
  name: string;
}

interface UseGameRoomArgs {
  code: string;
  myIndex: 0 | 1;
  myName: string;
}

export interface GameRoom {
  state: FdState;
  phase: FdPhase;
  connected: boolean;
  bothPresent: boolean;
  partnerName: string | null;
  /** index of the player whose turn it is (0 or 1) */
  currentDrawer: 0 | 1;
  isMyTurn: boolean;
  /** the panel index the current drawer is working on (0..TOTAL-1) */
  activePanel: number;
  /** previous panel (for the seam peek), if any */
  prevPanel: FdPanel | undefined;
  submitPanel: (strokes: Stroke[], style: PieceStyle) => void;
  restart: () => void;
}

export function useGameRoom({ code, myIndex, myName }: UseGameRoomArgs): GameRoom {
  const [state, setState] = useState<FdState>({ rev: 0, panels: [] });
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const nameRef = useRef(myName);
  nameRef.current = myName;

  const channel = useMemo(
    () =>
      supabase.channel(`fd:${code}`, {
        config: {
          broadcast: { self: false },
          presence: { key: String(myIndex) },
        },
      }),
    [code, myIndex],
  );

  // adopt an incoming full-state if its revision is newer than ours
  const adopt = useCallback((incoming: FdState) => {
    setState((prev) => (incoming.rev > prev.rev ? incoming : prev));
  }, []);

  const broadcast = useCallback(
    (next: FdState) => {
      void channel.send({ type: 'broadcast', event: 'sync', payload: next });
    },
    [channel],
  );

  useEffect(() => {
    let alive = true;
    const readPresence = () => {
      const raw = channel.presenceState() as Record<string, Array<Partial<PeerInfo>>>;
      const list: PeerInfo[] = [];
      Object.values(raw).forEach((metas) => {
        const m = metas[0];
        if (m && (m.index === 0 || m.index === 1)) {
          list.push({ index: m.index, name: m.name ?? '' });
        }
      });
      if (alive) setPeers(list);
    };

    channel
      .on('broadcast', { event: 'sync' }, ({ payload }) => {
        if (payload && Array.isArray((payload as FdState).panels)) adopt(payload as FdState);
      })
      .on('broadcast', { event: 'request' }, () => {
        // a peer joined and wants the current state
        broadcast(stateRef.current);
      })
      .on('presence', { event: 'sync' }, readPresence)
      .on('presence', { event: 'join' }, readPresence)
      .on('presence', { event: 'leave' }, readPresence)
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (alive) setConnected(true);
        void channel.track({ index: myIndex, name: nameRef.current });
        void channel.send({ type: 'broadcast', event: 'request' });
        broadcast(stateRef.current);
      });

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [channel, myIndex, adopt, broadcast]);

  // keep presence name fresh if the user types it after connecting
  useEffect(() => {
    if (connected) void channel.track({ index: myIndex, name: myName });
  }, [connected, channel, myIndex, myName]);

  const submitPanel = useCallback(
    (strokes: Stroke[], style: PieceStyle) => {
      setState((prev) => {
        if (prev.panels.length >= TOTAL_PANELS) return prev;
        const by = (prev.panels.length % 2) as 0 | 1;
        const next: FdState = {
          rev: prev.rev + 1,
          panels: [...prev.panels, { by, strokes, svgStyle: style.svgStyle, mods: style.mods, toneFills: style.toneFills, view: style.view ?? '2d' }],
        };
        stateRef.current = next;
        broadcast(next);
        return next;
      });
    },
    [broadcast],
  );

  const restart = useCallback(() => {
    setState((prev) => {
      const next: FdState = { rev: prev.rev + 1, panels: [] };
      stateRef.current = next;
      broadcast(next);
      return next;
    });
  }, [broadcast]);

  const bothPresent = peers.length >= 2;
  const partner = peers.find((p) => p.index !== myIndex);
  const partnerName = partner ? partner.name || null : null;

  const activePanel = Math.min(state.panels.length, TOTAL_PANELS - 1);
  const currentDrawer = (state.panels.length % 2) as 0 | 1;
  const isMyTurn = state.panels.length < TOTAL_PANELS && currentDrawer === myIndex;

  let phase: FdPhase;
  if (state.panels.length >= TOTAL_PANELS) phase = 'reveal';
  else if (state.panels.length > 0 || bothPresent) phase = 'drawing';
  else phase = 'lobby';

  return {
    state,
    phase,
    connected,
    bothPresent,
    partnerName,
    currentDrawer,
    isMyTurn,
    activePanel,
    prevPanel: state.panels[state.panels.length - 1],
    submitPanel,
    restart,
  };
}
