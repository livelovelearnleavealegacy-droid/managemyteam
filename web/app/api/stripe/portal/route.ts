// POST /api/stripe/portal — returns a Stripe customer-portal URL so the
// admin can update their payment method or cancel. Admin only.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { createPortalSession } from '@/lib/stripe';

export async function POST() {
  const session = await requireAdmin();

  const customerId = await withUser(session.profile.id, async (q) => {
    const r = await q(
      'SELECT stripe_customer_id FROM businesses WHERE id = $1 LIMIT 1',
      [session.business.id]
    );
    return (r.rows[0]?.stripe_customer_id as string | null | undefined) ?? null;
  });
  if (!customerId) {
    return NextResponse.json(
      { error: 'No billing account yet. Start a subscription first.' },
      { status: 400 }
    );
  }

  try {
    const url = await createPortalSession(customerId);
    return NextResponse.json({ url });
  } catch (e) {
    console.error('portal failed:', e);
    return NextResponse.json(
      { error: 'Could not open the billing portal. Billing is not configured yet.' },
      { status: 500 }
    );
  }
}
