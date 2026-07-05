// OnboardingFlow — "claim your space" first-run moment (personal-space MVP).
//
// A friendly, skippable overlay that greets a new visitor with an
// already-yours handle (e.g. "@doodled-finch") and three ways to settle it:
//   • Keep         — accept the generated handle and enter
//   • Reroll       — spin a fresh adjective+noun pair (haikunator pattern)
//   • Type-your-own — pick a custom handle (normalized + DB-uniqueness checked)
//
// UX principles (cited in docs/SCAFFOLD-PLAN.md): minimum friction to the
// aha-moment — the handle is PRE-FILLED and valid, so the zero-effort path is one
// click (Keep). Identity is invitational, never a gate: a "Skip for now" exit
// keeps the deterministic handle and lets them straight in. This mirrors the
// Mural/FigJam auto-assigned-handle pattern (everyone gets a friendly identity
// with no input).
//
// FLAGGED + STUBBED INTEGRATION: this component is rendered by DeskPage ONLY when
// isPersonalSpaceEnabled() (lib/personalSpace.ts) is true AND the visitor hasn't
// onboarded yet (localStorage marker). Until the migrations are applied + the
// flag flips, it never mounts — DB-safe.

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IS, ISe } from '../../lib/typography';
import { PILL, CTA, SECTION_LABEL, RAISED_SHADOW } from '../../lib/chromeStyles';
import { PAPER_GRAIN } from '../../lib/deskCraft';
import {
  handleFromId,
  randomHandle,
  appendToken,
  normalizeHandle,
  handleError,
  displayHandle,
} from '../../lib/handle';
import { getIdentityId, claimHandle, setLocalHandle } from '../../lib/personalSpace';

// localStorage marker so onboarding shows once. DeskPage also gates on this; the
// component owns the WRITE so "done" is recorded the moment they settle a handle.
const ONBOARDED_KEY = 'dd.onboarded';

export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* private mode — onboarding may reshow; acceptable */
  }
}

type Step = 'meet' | 'custom';

export interface OnboardingFlowProps {
  /** Called when the visitor settles (Keep / Reroll-then-Keep / custom / skip).
   *  Receives the final handle so the host can show it immediately. */
  onDone: (handle: string) => void;
}

export function OnboardingFlow({ onDone }: OnboardingFlowProps) {
  // Start from the deterministic handle for this identity so the very first
  // paint already shows "a handle that's yours" (no flicker, no empty state).
  const [handle, setHandle] = useState<string>(() => handleFromId(getIdentityId()));
  const [step, setStep] = useState<Step>('meet');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Escape skips (invitational, never a gate).
  const skip = useCallback(() => {
    markOnboarded();
    setLocalHandle(handle); // remember the on-screen handle even on skip
    onDone(handle);
  }, [handle, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skip]);

  // Settle on a handle: claim it server-side, append a token on collision, then
  // finish. On a pre-migration DB ('unavailable') we keep the local handle and
  // finish anyway — onboarding still feels real, persistence lands with the flag.
  const settle = useCallback(
    async (h: string, source: 'generated' | 'rerolled' | 'custom') => {
      setBusy(true);
      setNote(null);
      try {
        let candidate = h;
        // Up to 3 collision retries with an appended token (haikunator pattern).
        for (let attempt = 0; attempt < 3; attempt++) {
          const result = await claimHandle(candidate, source);
          if (result === 'claimed' || result === 'unavailable') {
            markOnboarded();
            setLocalHandle(candidate); // sticks across reloads + keeps chips in sync (DB on or off)
            onDone(candidate);
            return;
          }
          // 'taken' → disambiguate + retry.
          candidate = appendToken(candidate);
          setNote(`That one's taken — trying ${displayHandle(candidate)}…`);
        }
        setNote('Couldn’t settle that handle — try Reroll or another name.');
      } catch {
        // Network/unknown — don't trap the user; keep the local handle + enter.
        markOnboarded();
        setLocalHandle(h);
        onDone(h);
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );

  const reroll = useCallback(() => {
    setNote(null);
    setHandle(randomHandle());
  }, []);

  const customNorm = normalizeHandle(custom);
  const customErr = step === 'custom' ? handleError(customNorm) : null;

  return (
    <div
      // Scrim — same convention as DrawPanel (z300, tinted ink). Click outside
      // = skip (the invitational exit).
      onClick={skip}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 320,
        background: 'color-mix(in srgb, var(--dir-text-primary) 28%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Claim your space"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: 'relative',
          background: 'var(--dir-raised)',
          border: '1px solid var(--dir-border)',
          borderRadius: 16,
          boxShadow: RAISED_SHADOW,
          padding: 28,
          width: 'min(440px, calc(100vw - 64px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          fontFamily: IS,
          overflow: 'hidden',
        }}
      >
        {/* Paper-grain wash — warmth, not realism (deskCraft). Behind content. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: PAPER_GRAIN,
            opacity: 0.5,
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...SECTION_LABEL }}>Welcome to your desk</span>
          <h2
            style={{
              fontFamily: ISe,
              fontSize: 24,
              lineHeight: 1.15,
              letterSpacing: '-0.01em',
              color: 'var(--dir-text-primary)',
              margin: 0,
            }}
          >
            Claim your space
          </h2>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--dir-text-body)', margin: 0 }}>
            You get a private desk and a drawer for your own doodles. Here’s a
            name that’s already yours — keep it, reroll, or type your own.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {step === 'meet' ? (
            <motion.div
              key="meet"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              {/* The handle, big + warm — the moment. */}
              <motion.div
                key={handle}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  alignSelf: 'center',
                  fontFamily: ISe,
                  fontSize: 30,
                  letterSpacing: '-0.01em',
                  color: 'var(--dir-text-primary)',
                  padding: '14px 22px',
                  border: '1px dashed var(--dir-border)',
                  borderRadius: 14,
                  background: 'color-mix(in srgb, var(--dir-text-primary) 3%, transparent)',
                }}
              >
                {displayHandle(handle)}
              </motion.div>

              {note && (
                <p style={{ ...SECTION_LABEL, textTransform: 'none', textAlign: 'center', margin: 0 }}>
                  {note}
                </p>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={reroll}
                  disabled={busy}
                  style={{ ...PILL, opacity: busy ? 0.5 : 1 }}
                >
                  ↻ Reroll
                </button>
                <button
                  onClick={() => {
                    setCustom(handle);
                    setStep('custom');
                  }}
                  disabled={busy}
                  style={{ ...PILL, opacity: busy ? 0.5 : 1 }}
                >
                  Type your own
                </button>
                <button
                  onClick={() => settle(handle, 'generated')}
                  disabled={busy}
                  style={{ ...CTA, opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? 'Settling…' : 'Keep it →'}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="custom"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <label style={{ ...SECTION_LABEL, textTransform: 'none' }} htmlFor="dd-handle-input">
                Your handle
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  border: '1px solid var(--dir-border)',
                  borderRadius: 999,
                  padding: '8px 16px',
                  background: 'var(--dir-bg)',
                }}
              >
                <span style={{ color: 'var(--dir-text-body-soft)', fontSize: 15 }}>@</span>
                <input
                  id="dd-handle-input"
                  autoFocus
                  value={custom}
                  onChange={(e) => {
                    setNote(null);
                    setCustom(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !customErr && !busy) settle(customNorm, 'custom');
                  }}
                  placeholder="doodled-finch"
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontFamily: IS,
                    fontSize: 15,
                    color: 'var(--dir-text-primary)',
                  }}
                />
              </div>
              {/* Live preview of the normalized form when it differs from input. */}
              {customNorm && customNorm !== custom.toLowerCase().trim() && (
                <span style={{ ...SECTION_LABEL, textTransform: 'none' }}>
                  Saved as {displayHandle(customNorm)}
                </span>
              )}
              {(customErr || note) && (
                <span
                  style={{
                    fontFamily: IS,
                    fontSize: 12,
                    color: customErr ? 'var(--dir-danger, #b4452f)' : 'var(--dir-text-body)',
                  }}
                >
                  {customErr ?? note}
                </span>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                <button onClick={() => setStep('meet')} disabled={busy} style={PILL}>
                  ← Back
                </button>
                <button
                  onClick={() => settle(customNorm, 'custom')}
                  disabled={busy || !!customErr}
                  style={{ ...CTA, opacity: busy || customErr ? 0.5 : 1 }}
                >
                  {busy ? 'Settling…' : 'Claim it →'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Invitational exit — identity is never a gate. */}
        <button
          onClick={skip}
          disabled={busy}
          style={{
            position: 'relative',
            alignSelf: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: IS,
            fontSize: 12,
            color: 'var(--dir-text-body-soft)',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Skip for now
        </button>
      </motion.div>
    </div>
  );
}
