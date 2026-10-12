import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import bcrypt from 'bcryptjs';
import { auth, signIn } from '@/auth';
import { ownerPool } from '@/lib/db';
import SignupForm from './SignupForm';

export type SignupState = { error?: string };

/**
 * Creates a brand-new business and its first admin user, then signs in.
 *
 * Runs on the owner connection (bypasses RLS; the RLS onboarding policies
 * remain as defense-in-depth). A signup can NEVER attach to an existing
 * business — there is no business-id input anywhere in this flow.
 */
async function signupAction(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  'use server';

  const businessName = String(formData.get('businessName') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!businessName) return { error: 'Please enter your business name.' };
  if (!name) return { error: 'Please enter your name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Please enter a valid email address.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters long.' };
  }

  const existing = await ownerPool.query(
    'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
    [email]
  );
  if (existing.rows.length > 0) {
    return {
      error:
        'An account with that email already exists. Try signing in instead.',
    };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const client = await ownerPool.connect();
  try {
    await client.query('BEGIN');
    const biz = await client.query(
      "INSERT INTO businesses (id, name, trial_ends_at) VALUES (gen_random_uuid(), $1, now() + interval '14 days') RETURNING id",
      [businessName]
    );
    await client.query(
      "INSERT INTO users (id, business_id, name, email, role, password_hash) VALUES (gen_random_uuid(), $1, $2, $3, 'admin', $4)",
      [biz.rows[0].id, name, email, passwordHash]
    );
    await client.query('COMMIT');
  } catch (err: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
      return {
        error:
          'An account with that email already exists. Try signing in instead.',
      };
    }
    return { error: 'Could not create your account. Please try again.' };
  } finally {
    client.release();
  }

  try {
    await signIn('credentials', { email, password, redirectTo: '/overview' });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error:
          'Account created, but we could not sign you in automatically. Please sign in.',
      };
    }
    throw error;
  }
  return {};
}

export default async function SignupPage() {
  // Already signed in AND onboarded? There is nothing to do here — send them
  // to the app. (Authenticated but no users row yet is the onboarding path
  // itself, so they stay on this page.)
  const session = await auth();
  if (session?.user?.id) {
    const { rows } = await ownerPool.query(
      'SELECT id FROM users WHERE id = $1 LIMIT 1',
      [session.user.id]
    );
    if (rows.length > 0) redirect('/overview');
  }

  return (
    <>
      <h1 className="page-title">managemyteam.io</h1>
      <p className="auth-sub">Start your 14-day free trial</p>
      <SignupForm action={signupAction} />
    </>
  );
}
