import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { ownerPool } from '@/lib/db';

declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Railway runs behind a proxy; trust the forwarded host headers.
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt' },
  // Unauthenticated middleware hits land here instead of the default
  // NextAuth sign-in page.
  pages: { signIn: '/login' },
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
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (typeof token.sub === 'string') session.user.id = token.sub;
      return session;
    },
    // Runs in the Edge middleware. Pure by design — no DB access here.
    // Mirrors the original middleware.ts redirect behavior:
    //  - signed out  -> only /login and /signup are public, everything else
    //    bounces to /login (via `false` + pages.signIn)
    //  - signed in   -> /login, /signup, and / send you to /overview
    authorized({ auth: session, request }) {
      const { pathname } = request.nextUrl;
      const isAuthPage = pathname === '/login' || pathname === '/signup';

      if (!session?.user) return isAuthPage;

      if (isAuthPage || pathname === '/') {
        return Response.redirect(new URL('/overview', request.nextUrl));
      }
      return true;
    },
  },
});
