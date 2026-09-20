import type { ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Inspection } from './Inspection';

const navigation = [
  ['/', 'Today'],
  ['/chat', 'Chat'],
  ['/topics', 'Topics'],
  ['/archive', 'Archive'],
  ['/settings', 'Memory & settings'],
  ['/inspect', 'Content lab'],
] as const;

/** Shared routed shell; future screens receive Agent-backed data through this module. */
export function AppShell({ connection }: { connection: string }) {
  return (
    <main>
      <header>
        <Link className="wordmark" to="/">
          Personal Briefing
        </Link>
        <span className="status" role="status">
          {connection}
        </span>
      </header>
      <nav aria-label="Primary navigation">
        {navigation.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
      <footer>
        Your briefings are saved in your personal library. Sources open on their
        publisher’s website.
      </footer>
    </main>
  );
}

/** Honest placeholder for a planned product screen. */
export function PlannedScreen({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="planned-screen">
      <p className="eyebrow">COMING IN A LATER SLICE</p>
      <h1>{title}</h1>
      <p className="intro">{children}</p>
      <p className="notice">
        There is no saved data or simulated result here yet.
      </p>
    </section>
  );
}

/** Content discovery workbench remains available outside the briefing screens. */
export function InspectScreen() {
  return <Inspection />;
}
