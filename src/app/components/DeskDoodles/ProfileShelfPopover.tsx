// ProfileShelfPopover — a mini-profile + public shelf for ANOTHER person
// (personal-space MVP). When you meet someone else's handle on the public desk
// (an owner chip / attribution), this opens their little card: who they are
// plus the doodles they've put out on their public shelf.
//
// It is a READ surface only — never an editor. You're peeking at someone else's
// shelf, not changing it.
//
// CHROME LINEAGE: this is the OnboardingFlow overlay pattern reused —
//   • position:fixed inset:0 scrim, tinted ink (primary 28% → transparent)
//   • click-outside = close · Escape = close (window keydown listener)
//   • framer-motion entrance on the dialog card
//   • paper-grain wash behind the content (warmth, not realism — deskCraft)
//   • a "×" close affordance
// zIndex sits at 330 — one above onboarding's 320 — so a shelf opened from a
// chip in another overlay still lands on top.
//
// DB-OFF SAFE: listShelfOf returns [] and getProfile returns null on a
// pre-migration / offline DB (both already swallow the missing-table error), so
// this renders an honest empty state and never crashes. getProfile is purely
// best-effort decoration — the header falls back to the handle passed in, and
// the shelf renders the moment it resolves regardless of whether the profile
// lookup ever lands.

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IS, ISe } from '../../lib/typography';
import { SECTION_LABEL, RAISED_SHADOW } from '../../lib/chromeStyles';
import { PAPER_GRAIN } from '../../lib/deskCraft';
import { displayHandle } from '../../lib/handle';
import { listShelfOf, getProfile, type ProfileRow } from '../../lib/personalSpace';
import type { DoodleRow } from '../../lib/publish';
import { sanitizeSvgMarkup } from '../../lib/svgUpload';
import { ObjectCard } from './ObjectCard';

export interface ProfileShelfPopoverProps {
  /** The identity id whose PUBLIC shelf we're showing (doodles.owner_id). */
  ownerId: string;
  /** The handle to show + label the empty state, used as-is when no claimed
   *  profile resolves (e.g. a derived handle from the desk chip). */
  handle: string;
  /** Close the popover (scrim click, Escape, the × button). */
  onClose: () => void;
  /** Optional — when the shelf was opened from another surface (a doodle's owner
   *  chip), RETURN to it instead of just closing. Renders a "← Back" affordance.
   *  This is the no-stacked-modals rule (object-model doc §"never nest a modal"):
   *  the shelf TAKES OVER the surface, and back walks the infinite-modal flow. */
  onBack?: () => void;
}

export function ProfileShelfPopover({ ownerId, handle, onClose, onBack }: ProfileShelfPopoverProps) {
  const [shelf, setShelf] = useState<DoodleRow[]>([]);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  // Escape closes — same convention as the onboarding overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load the shelf on mount / when the owner changes. The shelf is the content
  // and gates the loading flag; the profile is best-effort decoration loaded in
  // parallel (catch → null) and never blocks the render. A cancelled flag stops
  // a late response from writing into an unmounted / re-keyed instance.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProfile(null);

    void listShelfOf(ownerId)
      .catch(() => [] as DoodleRow[]) // DB off / pre-migration → honest empty
      .then((rows) => {
        if (cancelled) return;
        setShelf(rows);
        setLoading(false);
      });

    void getProfile(ownerId)
      .catch(() => null) // best-effort: a missing claimed handle is fine
      .then((p) => {
        if (!cancelled) setProfile(p);
      });

    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  const close = useCallback(() => onClose(), [onClose]);

  // Prefer the claimed handle if the profile resolved; otherwise the handle the
  // caller already had (a derived/desk-chip handle). displayHandle adds the @.
  const shownHandle = displayHandle(profile?.handle ?? handle);
  const emptyHandle = displayHandle(handle);

  return (
    <div
      // Scrim — same convention as OnboardingFlow (tinted ink). Click outside
      // closes. zIndex 330 (one above onboarding's 320).
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 330,
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
        aria-label={`${shownHandle}'s shelf`}
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
          width: 'min(560px, calc(100vw - 64px))',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: IS,
          overflow: 'hidden',
        }}
      >
        {/* Paper-grain wash — warmth, not realism (deskCraft). Behind content,
            fixed over the whole card so the scrolling shelf reads on one paper. */}
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

        {/* × close — quiet, top-right, above the wash. */}
        <button
          onClick={close}
          aria-label="Close"
          title="Close"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 1,
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: IS,
            fontSize: 20,
            lineHeight: 1,
            color: 'var(--dir-text-body-soft)',
            borderRadius: 999,
          }}
        >
          ×
        </button>

        {/* Header — eyebrow + the person's handle, big + warm. Padded; the shelf
            below owns its own scroll so the header stays put. */}
        <div
          style={{
            position: 'relative',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '28px 28px 16px',
          }}
        >
          {onBack && (
            // ← back to the surface this shelf was opened from (infinite-modal
            // nav — an emergency exit, never a stacked modal).
            <button
              onClick={onBack}
              title="Back to the doodle"
              style={{
                alignSelf: 'flex-start',
                marginBottom: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: IS,
                fontSize: 12,
                color: 'var(--dir-text-body-soft)',
              }}
            >
              ← Back
            </button>
          )}
          <span style={{ ...SECTION_LABEL }}>Their shelf</span>
          <h2
            style={{
              fontFamily: ISe,
              fontVariationSettings: '"SOFT" 60, "WONK" 1',
              fontSize: 28,
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              color: 'var(--dir-text-primary)',
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {shownHandle}
          </h2>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--dir-text-body)', margin: 0 }}>
            The doodles they've put out for everyone to see.
          </p>
        </div>

        {/* Shelf — the scroll region. Loading → empty → grid. */}
        <div
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '4px 28px 28px',
          }}
        >
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.p
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  ...SECTION_LABEL,
                  textTransform: 'none',
                  color: 'var(--dir-text-body-soft)',
                  margin: 0,
                }}
              >
                Loading the shelf…
              </motion.p>
            ) : shelf.length === 0 ? (
              <motion.p
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  ...SECTION_LABEL,
                  textTransform: 'none',
                  color: 'var(--dir-text-body-soft)',
                  margin: 0,
                }}
              >
                Nothing on {emptyHandle}'s shelf yet.
              </motion.p>
            ) : (
              <motion.div
                key="grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: 12,
                }}
              >
                {shelf.map((row) => (
                  <ObjectCard
                    key={row.id}
                    svgMarkup={sanitizeSvgMarkup(row.svg)}
                    name={row.name}
                    mini
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
