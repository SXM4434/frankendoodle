import { createBrowserRouter, NavLink } from 'react-router';
import { IS } from './lib/typography';
import { DeskDoodlesHome } from './components/DeskDoodles/DeskDoodlesHome';
import { DeskDoodlesCanvas } from './components/DeskDoodles/DeskDoodlesCanvas';
import { DeskPage } from './components/DeskDoodles/DeskPage';
import { DeskGallery } from './components/DeskDoodles/DeskGallery';
import { DeskDoodlesPublicCanvas } from './components/DeskDoodles/DeskDoodlesPublicCanvas';
import { DeskDoodlesPlayground } from './components/DeskDoodles/DeskDoodlesPlayground';
import { DeskDoodlesAudit } from './components/DeskDoodles/DeskDoodlesAudit';
import { PosterDiag } from './components/DeskDoodles/PosterDiag';
import { YourSpacePage } from './components/DeskDoodles/YourSpacePage';
import { DrawerPage } from './components/DeskDoodles/DrawerPage';
import { FrankendoodlePage } from './components/Frankendoodle/FrankendoodlePage';

function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--dir-bg)',
        color: 'var(--dir-text-primary)',
        fontFamily: IS,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 16,
        padding: 48,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 13 }}>Not found.</div>
      <NavLink to="/" style={{ color: 'var(--dir-text-primary)', fontSize: 13 }}>
        ← Back to Desk Doodles home
      </NavLink>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: '/', Component: FrankendoodlePage },
  { path: '/home', Component: DeskDoodlesHome },
  { path: '/play', Component: FrankendoodlePage },
  // /canvas = the drawing primitive's TEST surface; /desk = the real product
  // flow (desk canvas + DrawPanel popup) per project_desk_doodles_draw_panel_vs_desk_canvas.
  { path: '/canvas', Component: DeskDoodlesCanvas },
  { path: '/desk', Component: DeskPage },
  // /desks = the public desk GALLERY (browse the wall of walls — newest-first
  // grid of desk cards; a card opens /desk?desk=<desk_index>).
  { path: '/desks', Component: DeskGallery },
  { path: '/public', Component: DeskDoodlesPublicCanvas },
  { path: '/playground', Component: DeskDoodlesPlayground },
  // Personal-space IA (R9): the "Your space" door + the full-page Drawer/Shelf.
  { path: '/your-space', Component: YourSpacePage },
  { path: '/drawer', Component: DrawerPage },
  { path: '/audit', Component: DeskDoodlesAudit },
  { path: '/poster-diag', Component: PosterDiag },
  { path: '*', Component: NotFound },
]);
