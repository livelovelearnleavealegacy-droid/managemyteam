// managemyteam.io — Stripe helpers (server only; never import client-side).
//
// Locked billing decisions (implement exactly):
//   * $1 per employee per month, minimum 10 employees ($10/mo floor).
//   * Stripe subscription quantity = max(10, activeCount),
//     where activeCount = users with terminated_at IS NULL.
//   * 14-day trial, no card upfront (trial_ends_at set at signup).
//   * Billing basis "not terminated", prorated by days active — Stripe's
//     default proration on quantity changes handles this; we keep the
//     default proration_behavior on subscription updates.
//   * Termination takes effect when processed or on a future date up to
//     30 days out. No tiers; everyone gets all functionality.

import Stripe from 'stripe';
import { db } from '@/lib/db';

const PRICE_LOOKUP_KEY = 'managemyteam_pepm_v1';
const PRODUCT_NAME = 'managemyteam.io per-employee';

let stripeInstance: Stripe | null = null;

/** Lazily-created Stripe client. Requires STRIPE_SECRET_KEY. */
export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}

function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url) {
    throw new Error('APP_URL is not set');
  }
  return url.replace(/\/$/, '');
}

/**
 * Returns the price id for the $1/employee/month plan, creating the product
 * and price on first use (idempotent via lookup key).
 */
export async function ensurePrice(): Promise<string> {
  const stripe = getStripe();

  const existing = await stripe.prices.list({
    lookup_keys: [PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  if (existing.data.length > 0) {
    return existing.data[0].id;
  }

  const product = await stripe.products.create({ name: PRODUCT_NAME });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: 100, // $1.00
    currency: 'usd',
    recurring: { interval: 'month' },
    lookup_key: PRICE_LOOKUP_KEY,
  });
  return price.id;
}

/**
 * Finds the Stripe customer tagged with this business id, or creates one.
 */
export async function ensureCustomer(b: {
  id: string;
  name: string;
}): Promise<string> {
  const stripe = getStripe();

  const found = await stripe.customers.search({
    query: `metadata['business_id']:'${b.id}'`,
    limit: 1,
  });
  if (found.data.length > 0) {
    return found.data[0].id;
  }

  const customer = await stripe.customers.create({
    name: b.name,
    metadata: { business_id: b.id },
  });
  return customer.id;
}

/**
 * Number of users with terminated_at IS NULL in the business.
 *
 * Railway port: runs on the owner connection (service-level billing read,
 * tenancy scoped by the explicit business_id filter) so the webhook route
 * and checkout flow share one implementation without a user session.
 */
export async function getActiveCount(businessId: string): Promise<number> {
  const { rows } = await db.query(
    'select count(*)::int as count from users where business_id = $1 and terminated_at is null',
    [businessId]
  );
  return (rows[0] as { count: number } | undefined)?.count ?? 0;
}

/**
 * Sets the subscription quantity to max(10, activeCount). Stripe's default
 * proration applies, so mid-cycle adds/removes are prorated by days active.
 */
export async function setSubscriptionQuantity(
  subscriptionId: string,
  activeCount: number
): Promise<void> {
  const stripe = getStripe();
  const quantity = Math.max(10, activeCount);

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const item = sub.items.data[0];
  if (!item) {
    throw new Error('Subscription ' + subscriptionId + ' has no line items');
  }
  if (item.quantity === quantity) {
    return; // Nothing to change.
  }

  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: item.id, quantity }],
    proration_behavior: 'create_prorations',
  });
}

/**
 * Creates a subscription Checkout session: $1/employee/month, quantity
 * floored at 10, trial through trialEndISO, no card required upfront.
 */
export async function createCheckoutSession(
  b: { id: string; name: string },
  adminEmail: string,
  trialEndISO: string
): Promise<string> {
  const stripe = getStripe();
  const customerId = await ensureCustomer(b);
  const priceId = await ensurePrice();
  const activeCount = await getActiveCount(b.id);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    customer_email: adminEmail,
    line_items: [{ price: priceId, quantity: Math.max(10, activeCount) }],
    subscription_data: {
      trial_end: Math.floor(new Date(trialEndISO).getTime() / 1000),
      metadata: { business_id: b.id },
    },
    success_url: appUrl() + '/settings?billing=success',
    cancel_url: appUrl() + '/settings?billing=cancelled',
  });

  if (!session.url) {
    throw new Error('Checkout session was created but has no URL');
  }
  return session.url;
}

/** Creates a customer-portal session for managing the subscription. */
export async function createPortalSession(customerId: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: appUrl() + '/settings',
  });
  return session.url;
}
