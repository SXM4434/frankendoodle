import { useCallback, useRef, useState } from 'react';
import { NavLink } from 'react-router';
import { IS, ISe } from '../../lib/typography';
import { CTA, PILL, SECTION_LABEL } from '../../lib/chromeStyles';
import {
  F3_TROPHY_WALL_SUBJECTS,
  type F3SubjectId,
  type F3TrophyWallShapeId,
} from '../../lib/items/identitySet';
import { PinShape } from '../../lib/items/PinShape';
import { SvgStyleTransform } from '../canvas/SvgStyleTransform';
import {
  CollapsiblePanel,
  PanelToggle,
  useMinimizeUi,
  usePanelOpen,
} from '../chrome/CollapsiblePanel';
import { SmartHachureChrome } from '../chrome/SmartHachureChrome';

type CanvasMode = 'svg' | '3d';

type PlacedItem = {
  id: string;
  shape: F3TrophyWallShapeId;
  x: number;
  y: number;
};

export function DeskDoodlesPlayground() {
  // Smart Hachure is now default-ON in SvgStyleTransform (opt-out via
  // ?smartHachure=0), so the playground no longer needs the param-set + reload
  // dance — that reload was the white flash on every fresh visit.

  const [mode, setMode] = useState<CanvasMode>('svg');
  const [items, setItems] = useState<PlacedItem[]>([]);
  const [activeSubject, setActiveSubject] = useState<F3SubjectId>('sketching');
  const [leftOpen, toggleLeft, setLeftOpen] = usePanelOpen('playground.left');
  const [rightOpen, toggleRight, setRightOpen] = usePanelOpen('playground.right');
  useMinimizeUi([
    { open: leftOpen, setOpen: setLeftOpen },
    { open: rightOpen, setOpen: setRightOpen },
  ]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const activeSubjectDef = F3_TROPHY_WALL_SUBJECTS.find((s) => s.id === activeSubject);

  const addItem = useCallback((shape: F3TrophyWallShapeId) => {
    setItems((prev) => {
      const offset = (prev.length % 8) * 32;
      const rowOffset = Math.floor(prev.length / 8) * 32;
      return [
        ...prev,
        {
          id: `${shape}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          shape,
          x: 80 + offset,
          y: 80 + rowOffset + offset * 0.5,
        },
      ];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, item: PlacedItem) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffsetRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setDraggingId(item.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingId || !canvasRef.current) return;
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - canvasRect.left - dragOffsetRef.current.dx;
      const y = e.clientY - canvasRect.top - dragOffsetRef.current.dy;
      setItems((prev) => prev.map((i) => (i.id === draggingId ? { ...i, x, y } : i)));
    },
    [draggingId],
  );

  const handlePointerUp = useCallback(() => setDraggingId(null), []);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--dir-bg)',
        color: 'var(--dir-text-primary)',
        fontFamily: IS,
        overflow: 'hidden',
      }}
    >
      {/* ─── Top chrome ─────────────────────────────────────────────── */}
      <header
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--dir-border)',
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 16,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <NavLink
            to="/"
            style={{
              fontFamily: ISe,
              fontSize: 17,
              letterSpacing: '-0.01em',
              color: 'var(--dir-text-primary)',
              textDecoration: 'none',
            }}
          >
            Desk Doodles
          </NavLink>
          <PanelToggle
            side="left"
            open={leftOpen}
            label="Items"
            onToggle={toggleLeft}
            controlsId="playground-left-panel"
          />
        </div>

        <div
          style={{
            display: 'inline-flex',
            border: '1px solid var(--dir-border)',
            borderRadius: 999,
            overflow: 'hidden',
          }}
        >
          {(['svg', '3d'] as CanvasMode[]).map((m) => {
            // HONESTY-GATE (2026-06-21): this playground has no `mode==='3d'` render
            // branch — clicking 3D used to just highlight the pill and mount nothing.
            // 3D testing lives on /canvas (the real 2D↔3D test surface); disable the
            // dead toggle here instead of pretending it works.
            const dead = m === '3d';
            return (
              <button
                key={m}
                onClick={() => { if (!dead) setMode(m); }}
                disabled={dead}
                title={dead ? '3D testing lives on /canvas — this playground is 2D only' : undefined}
                style={{
                  ...PILL,
                  border: 'none',
                  borderRadius: 0,
                  background: mode === m ? 'var(--dir-accent)' : 'transparent',
                  color: mode === m ? 'var(--dir-bg)' : 'var(--dir-text-body)',
                  ...(dead ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
                }}
              >
                {m === 'svg' ? '2D' : '3D'}
              </button>
            );
          })}
        </div>

        <div style={{ justifySelf: 'end', display: 'flex', gap: 8, alignItems: 'center' }}>
          <PanelToggle
            side="right"
            open={rightOpen}
            label="Controls"
            onToggle={toggleRight}
            controlsId="playground-right-panel"
          />
          <button
            disabled
            title="Publishing lives on /desk — this page is the test surface"
            style={{ ...CTA, opacity: 0.4, cursor: 'not-allowed' }}
          >
            Publish
          </button>
        </div>
      </header>

      {/* ─── Body: left panel + canvas + right panel ──────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* LEFT PANEL — items picker */}
        <CollapsiblePanel
          side="left"
          open={leftOpen}
          width={360}
          id="playground-left-panel"
          style={{
            borderRight: '1px solid var(--dir-border)',
            background: 'var(--dir-raised)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
            <div
              style={{
                padding: '14px 16px',
                borderBottom: '1px solid var(--dir-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={SECTION_LABEL}>Items</span>
              <span style={{ ...SECTION_LABEL, color: 'var(--dir-text-body-soft)' }}>
                {items.length} placed
              </span>
            </div>

            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '110px 1fr', minHeight: 0 }}>
              <nav
                style={{
                  borderRight: '1px solid var(--dir-border)',
                  overflowY: 'auto',
                  padding: '8px 6px',
                }}
              >
                {F3_TROPHY_WALL_SUBJECTS.map((subj) => {
                  const active = subj.id === activeSubject;
                  return (
                    <button
                      key={subj.id}
                      onClick={() => setActiveSubject(subj.id)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'center',
                        padding: '8px 14px',
                        background: active ? 'var(--dir-bg)' : 'transparent',
                        border: `1px solid ${active ? 'var(--dir-accent)' : 'transparent'}`,
                        // Nested nav rows, some multi-line ("Roots (CO / US)")
                        // — soft radius like dropdown rows, NOT full pill.
                        borderRadius: 10,
                        color: active ? 'var(--dir-text-primary)' : 'var(--dir-text-body)',
                        fontFamily: IS,
                        fontSize: 12,
                        fontWeight: active ? 600 : 400,
                        cursor: 'pointer',
                      }}
                    >
                      {subj.displayName}
                    </button>
                  );
                })}
              </nav>

              <div
                style={{
                  overflowY: 'auto',
                  padding: 12,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 8,
                  alignContent: 'start',
                }}
              >
                {activeSubjectDef?.forms.map((form) => (
                  <button
                    key={form.shape}
                    onClick={() => addItem(form.shape)}
                    title={form.label}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 8,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      borderRadius: 16,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dir-bg)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div
                      style={{
                        aspectRatio: '1 / 1',
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      <PinShape shape={form.shape} />
                    </div>
                    <div
                      style={{
                        fontFamily: IS,
                        fontSize: 9,
                        color: 'var(--dir-text-body-soft)',
                        letterSpacing: '0.02em',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '100%',
                      }}
                    >
                      {form.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>
        </CollapsiblePanel>

        {/* MAIN CANVAS */}
        <main
          ref={canvasRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{
            flex: 1,
            position: 'relative',
            background: 'var(--dir-bg)',
            overflow: 'auto',
            cursor: draggingId ? 'grabbing' : 'default',
          }}
        >
          {items.length === 0 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--dir-text-body-soft)',
                fontFamily: IS,
                fontSize: 12,
                textAlign: 'center',
                pointerEvents: 'none',
              }}
            >
              Pick items from the left panel.<br />
              Twist Smart Hachure controls on the right to see them re-render.<br />
              Drag any item to move it. Hover and click ✕ to remove.
            </div>
          )}

          {items.map((item) => (
            <div
              key={item.id}
              onPointerDown={(e) => handlePointerDown(e, item)}
              style={{
                position: 'absolute',
                left: item.x,
                top: item.y,
                width: 140,
                cursor: draggingId === item.id ? 'grabbing' : 'grab',
                touchAction: 'none',
                userSelect: 'none',
              }}
            >
              <SvgStyleTransform>
                <PinShape shape={item.shape} />
              </SvgStyleTransform>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeItem(item.id);
                }}
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  border: '1px solid var(--dir-border)',
                  background: 'var(--dir-bg)',
                  color: 'var(--dir-text-body)',
                  fontFamily: IS,
                  fontSize: 11,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  opacity: 0,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onPointerEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onPointerLeave={(e) => (e.currentTarget.style.opacity = '0')}
              >
                ✕
              </button>
            </div>
          ))}
        </main>

        {/* RIGHT PANEL — verbatim Hero8Shell modifier chrome */}
        <CollapsiblePanel
          side="right"
          open={rightOpen}
          width={480}
          id="playground-right-panel"
          style={{
            borderLeft: '1px solid var(--dir-border)',
            background: 'var(--dir-raised)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
          }}
        >
          <SmartHachureChrome />
        </CollapsiblePanel>
      </div>
    </div>
  );
}
