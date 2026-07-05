import { NavLink } from 'react-router';
import { IS, ISe } from '../../lib/typography';
import { CTA } from '../../lib/chromeStyles';

export function DeskDoodlesPublicCanvas() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--dir-bg)',
        color: 'var(--dir-text-primary)',
        fontFamily: IS,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--dir-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <NavLink
          to="/"
          style={{
            fontFamily: ISe,
            fontSize: 18,
            letterSpacing: '-0.01em',
            color: 'var(--dir-text-primary)',
            textDecoration: 'none',
          }}
        >
          Desk Doodles
        </NavLink>
        <NavLink
          to="/desk"
          style={{
            ...CTA,
            padding: '8px 16px', // header CTA — keep larger padding than chrome PILL
            textDecoration: 'none',
          }}
        >
          Start doodling →
        </NavLink>
      </header>

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 48,
          gap: 24,
        }}
      >
        <h1
          style={{
            fontFamily: ISe,
            fontSize: 32,
            lineHeight: 1.15,
            letterSpacing: '-0.015em',
            margin: 0,
            color: 'var(--dir-text-primary)',
          }}
        >
          The wall lives on your desk.
        </h1>
        <p
          style={{
            fontFamily: IS,
            fontSize: 15,
            lineHeight: 1.55,
            color: 'var(--dir-text-body)',
            margin: 0,
            maxWidth: 560,
            textAlign: 'center',
          }}
        >
          Everyone&rsquo;s published doodles scatter onto a shared desk — mixed styles, mixed
          modes, slight tilt. Draw something, hit Done, and watch it land live next to everyone
          else&rsquo;s.
        </p>
        <NavLink
          to="/desk"
          style={{
            ...CTA,
            padding: '10px 18px',
            textDecoration: 'none',
          }}
        >
          Open the desk →
        </NavLink>
      </main>
    </div>
  );
}
