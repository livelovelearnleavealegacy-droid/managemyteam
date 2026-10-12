import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import AppNav from '@/components/AppNav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (session.profile.terminated_at) redirect('/deactivated');

  return (
    <AppNav
      role={session.profile.role}
      businessName={session.business.name}
      userName={session.profile.name}
    >
      {children}
    </AppNav>
  );
}
