// Settings page (admin only): business profile, task defaults, categories,
// shift digest schedule, and billing.

import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import SettingsManager from './settings-manager';

export interface BusinessSettings {
  id: string;
  name: string;
  default_max_pushes: number;
  digest_schedule: { enabled: boolean; time: string; timezone: string };
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: { billing?: string };
}) {
  const session = await requireAdmin();
  const businessId = session.business.id;

  const { businessRow, categoryRows, activeCount } = await withUser(
    session.profile.id,
    async (q) => {
      // Queried sequentially: a single pg client cannot run queries concurrently.
      const b = await q(
        'SELECT id, name, default_max_pushes, digest_schedule, trial_ends_at, stripe_customer_id, stripe_subscription_id FROM businesses WHERE id = $1 LIMIT 1',
        [businessId]
      );
      const c = await q(
        'SELECT id, name FROM categories WHERE business_id = $1 ORDER BY name',
        [businessId]
      );
      const a = await q(
        'SELECT COUNT(*)::int AS count FROM users WHERE business_id = $1 AND terminated_at IS NULL',
        [businessId]
      );
      return {
        businessRow: b.rows[0] as
          | {
              id: string;
              name: string;
              default_max_pushes: number;
              digest_schedule: Record<string, unknown> | null;
              trial_ends_at: Date | null;
              stripe_customer_id: string | null;
              stripe_subscription_id: string | null;
            }
          | undefined,
        categoryRows: c.rows,
        activeCount: (a.rows[0]?.count as number) ?? 0,
      };
    }
  );

  if (!businessRow) {
    return (
      <div>
        <h1 className="page-title">Settings</h1>
        <p style={{ color: 'var(--text2)' }}>
          Business settings could not be loaded.
        </p>
      </div>
    );
  }

  const scheduleRaw = businessRow.digest_schedule ?? {};
  const business: BusinessSettings = {
    id: businessRow.id,
    name: businessRow.name,
    default_max_pushes: businessRow.default_max_pushes,
    digest_schedule: {
      enabled: scheduleRaw.enabled !== false,
      time: typeof scheduleRaw.time === 'string' ? scheduleRaw.time : '18:00',
      timezone:
        typeof scheduleRaw.timezone === 'string'
          ? scheduleRaw.timezone
          : 'America/Chicago',
    },
    trial_ends_at: businessRow.trial_ends_at
      ? new Date(businessRow.trial_ends_at).toISOString()
      : null,
    stripe_customer_id: businessRow.stripe_customer_id ?? null,
    stripe_subscription_id: businessRow.stripe_subscription_id ?? null,
  };

  const categories: CategoryRow[] = categoryRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
  }));

  const billingNotice =
    searchParams?.billing === 'success'
      ? 'Subscription started. Thank you.'
      : searchParams?.billing === 'cancelled'
        ? 'Checkout was cancelled. No changes were made.'
        : null;

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <SettingsManager
        business={business}
        categories={categories}
        activeCount={activeCount}
        billingNotice={billingNotice}
        adminEmail={session.authUser.email ?? ''}
      />
    </div>
  );
}
