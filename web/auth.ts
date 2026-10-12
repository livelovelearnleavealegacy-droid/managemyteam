import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { ownerPool } from '@/lib/db';
import { authConfig } from '@/auth.config';

/**
 * Full Auth.js setup (Node runtime ONLY — never import this from
 * middleware.ts; the Edge middleware uses auth.config.ts instead).
 *
 * The Credentials provider verifies email/password against public.users
 * via the owner pool (bypasses RLS — the caller has no session yet).
 * Everything else (secret, session strategy, callbacks, pages) comes
 * from the shared edge-safe config in auth.config.ts.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === 'string'
            ? credentials.email.trim().toLowerCase()
            : '';
        const password =
          typeof credentials?.password === 'string'
            ? credentials.password
            : '';
        if (!email || !password) return null;

        const { rows } = await ownerPool.query(
          'SELECT id, email, password_hash FROM users WHERE lower(email) = $1 LIMIT 1',
          [email]
        );
        const row = rows[0] as
          | { id: string; email: string; password_hash: string | null }
          | undefined;
        if (!row || !row.password_hash) return null;

        const ok = await bcrypt.compare(password, row.password_hash);
        if (!ok) return null;

        return { id: row.id, email: row.email };
      },
    }),
  ],
});
