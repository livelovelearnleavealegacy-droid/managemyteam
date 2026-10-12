'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/auth';
import ShiftLogFab from '@/components/ShiftLogFab';

interface NavLink {
  href: string;
  label: string;
}

interface NavCluster {
  label: string;
  links: NavLink[];
}

const STAFF_CLUSTERS: NavCluster[] = [
  {
    label: 'My work',
    links: [
      { href: '/tasks', label: 'Tasks' },
      { href: '/clock', label: 'Time clock' },
      { href: '/schedule', label: 'Schedule' },
      { href: '/time-off', label: 'Time off' },
    ],
  },
  {
    label: 'Team',
    links: [
      { href: '/chat', label: 'Chat' },
      { href: '/announcements', label: 'Announcements' },
      { href: '/kudos', label: 'Kudos' },
      { href: '/directory', label: 'Directory' },
    ],
  },
  {
    label: 'Resources',
    links: [{ href: '/knowledge', label: 'Knowledge' }],
  },
];

const MANAGER_CLUSTERS: NavCluster[] = [
  {
    label: 'Overview',
    links: [
      { href: '/overview', label: 'Daily board' },
      { href: '/calendar', label: 'Calendar' },
    ],
  },
  {
    label: 'Tasks & facility',
    links: [
      { href: '/tasks', label: 'Task board' },
      { href: '/tasks/templates', label: 'Task templates' },
      { href: '/inspections', label: 'Inspections' },
      { href: '/incidents', label: 'Incidents' },
    ],
  },
  {
    label: 'People',
    links: [
      { href: '/staff', label: 'Staff' },
      { href: '/teams', label: 'Teams' },
      { href: '/schedule', label: 'Scheduling' },
      { href: '/timesheets', label: 'Timesheets' },
      { href: '/time-off', label: 'Time off' },
    ],
  },
  {
    label: 'Culture',
    links: [
      { href: '/chat', label: 'Chat' },
      { href: '/announcements', label: 'Announcements' },
      { href: '/kudos', label: 'Kudos' },
      { href: '/directory', label: 'Directory' },
      { href: '/knowledge', label: 'Knowledge' },
    ],
  },
  {
    label: 'Admin',
    links: [
      { href: '/shift-log', label: 'Shift log' },
      { href: '/reports', label: 'Reports' },
      { href: '/settings', label: 'Settings' },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

export default function AppNav({
  role,
  businessName,
  userName,
  children,
}: {
  role: Role;
  businessName: string;
  userName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isManager = role === 'admin' || role === 'manager';
  const clusters = isManager ? MANAGER_CLUSTERS : STAFF_CLUSTERS;

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Primary">
        <div className="app-sidebar-brand">managemyteam.io</div>
        <nav>
          {clusters.map((cluster) => (
            <div key={cluster.label}>
              <div className="nav-cluster">{cluster.label}</div>
              {cluster.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    'nav-link' + (isActive(pathname, link.href) ? ' active' : '')
                  }
                  aria-current={isActive(pathname, link.href) ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <h1 className="app-business-name">{businessName}</h1>
          <span className="app-attribution">
            {userName} · powered by managemyteam.io
          </span>
        </header>
        <main className="app-content">{children}</main>
      </div>
      {isManager && <ShiftLogFab />}
    </div>
  );
}
