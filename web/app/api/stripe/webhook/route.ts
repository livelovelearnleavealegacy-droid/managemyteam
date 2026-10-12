// POST /api/stripe/webhook — Stripe event receiver.
//
// Verifies the signature with STRIPE_WEBHOOK_SECRET, then records the event
// id in stripe_events (idempotent: re-deliveries return 200 with
// duplicate:true and are not processed twice).
//
// Railway port: the Supabase service-role client is replaced by the owner
// pool (`db`), which bypasses RLS. All event handling is identical.
//
// Handles:
//   customer.subscription.created / updated -> store stripe_customer_id and
//     stripe_subscription_id on the business (matched by metadata.business_id)
//   customer.subscription.deleted -> clear stripe_subscription_id
//   invoice.payment_failed -> email every active admin to update their
//     payment method (skipped gracefully when email is unavailable)

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/db';
import { getStripe } from '@/lib/stripe';
import { sendEmail } from '@/lib/email';

function pgCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code: unknown }).code)
    : undefined;
}

function pgMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error';
}

/** Inserts the event id; returns true when this delivery is new. */
async function claimEvent(id: string, type: string): Promise<boolean> {
  try {
    await db.query('INSERT INTO stripe_events (id, type) VALUES ($1, $2)', [
      id,
      type,
    ]);
    return true;
  } catch (e) {
    if (pgCode(e) === '23505') {
      return false; // Already processed.
    }
    throw new Error('Could not record stripe event: ' + pgMessage(e));
  }
}

async function businessIdFromSubscription(
  subscription: Stripe.Subscription
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.business_id;
  if (fromMetadata) return fromMetadata;

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;
  const { rows } = await db.query(
    'SELECT id FROM businesses WHERE stripe_customer_id = $1 LIMIT 1',
    [customerId]
  );
  return (rows[0]?.id as string) ?? null;
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    console.error('webhook signature verification failed:', e);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let isNew: boolean;
  try {
    isNew = await claimEvent(event.id, event.type);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Could not record event' }, { status: 500 });
  }
  if (!isNew) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const businessId = await businessIdFromSubscription(subscription);
        if (businessId) {
          const customerId =
            typeof subscription.customer === 'string'
              ? subscription.customer
              : subscription.customer.id;
          await db.query(
            'UPDATE businesses SET stripe_customer_id = $1, stripe_subscription_id = $2 WHERE id = $3',
            [customerId, subscription.id, businessId]
          );
        } else {
          console.error(
            'subscription ' + subscription.id + ' matched no business; skipping'
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const businessId = await businessIdFromSubscription(subscription);
        if (businessId) {
          await db.query(
            'UPDATE businesses SET stripe_subscription_id = NULL WHERE id = $1',
            [businessId]
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === 'string'
            ? invoice.customer
            : invoice.customer?.id;
        if (customerId) {
          const business = (
            await db.query(
              'SELECT id, name FROM businesses WHERE stripe_customer_id = $1 LIMIT 1',
              [customerId]
            )
          ).rows[0] as { id: string; name: string } | undefined;
          if (business) {
            const admins = (
              await db.query(
                "SELECT email FROM users WHERE business_id = $1 AND role = 'admin' AND terminated_at IS NULL",
                [business.id]
              )
            ).rows;
            for (const a of admins) {
              const email = a.email as string | null;
              if (!email) continue;
              try {
                await sendEmail({
                  to: email,
                  subject: 'Payment failed — update your payment method',
                  html:
                    '<p>Hi,</p>' +
                    '<p>A payment for your managemyteam.io subscription (' +
                    business.name +
                    ') failed. Please update your payment method to keep your account active.</p>' +
                    '<p>You can do this from Settings, then Billing, then "Manage billing".</p>',
                });
              } catch (e) {
                // Skip gracefully: one bad address must not break the webhook.
                console.error('payment-failed email failed for ' + email + ':', e);
              }
            }
          }
        }
        break;
      }

      default:
        // Unhandled event types are recorded above and ignored.
        break;
    }
  } catch (e) {
    console.error('webhook handler failed for ' + event.type + ':', e);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
