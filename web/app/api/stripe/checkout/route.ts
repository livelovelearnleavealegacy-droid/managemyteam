// POST /api/stripe/checkout — starts the $1/employee/month subscription.
// Admin only. Creates (or reuses) the Stripe customer and price, then returns
// a Checkout URL with the trial carried through (no card required upfront).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { createCheckoutSession } from '@/lib/stripe';

export async function POST() {
  const session = await requireAdmin();

  const business = await withUser(session.profile.id, async (q) => {
    const r = await q(
      'SELECT id, name, trial_ends_at, stripe_subscription_id FROM businesses WHERE id = $1 LIMIT 1',
      [session.business.id]
    );
    return r.rows[0] as
      | {
          id: string;
          name: string;
          trial_ends_at: Date | null;
          stripe_subscription_id: string | null;
        }
      | undefined;
  });
  if (!business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 400 });
  }
  if (business.stripe_subscription_id) {
    return NextResponse.json(
      { error: 'This business already has a subscription. Use Manage billing instead.' },
      { status: 400 }
    );
  }

  const trialEnd = business.trial_ends_at
    ? new Date(business.trial_ends_at).toISOString()
    : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const url = await createCheckoutSession(
      { id: business.id, name: business.name },
      session.authUser.email ?? '',
      trialEnd
    );
    return NextResponse.json({ url });
  } catch (e) {
    console.error('checkout failed:', e);
    return NextResponse.json(
      { error: 'Could not start checkout. Billing is not configured yet.' },
      { status: 500 }
    );
  }
}
