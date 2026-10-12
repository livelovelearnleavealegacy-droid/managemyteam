import type { NextAuthConfig, DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}

/**
 * Edge-safe Auth.js config — everything the middleware needs, and NOTHING
 * that touches Node-only modules.
 *
 * This file must NEVER import the database (`@/lib/db` -> `pg`) or bcrypt:
 * the middleware runs in the Edge runtime, where evaluating `pg` throws
 * (`util.deprecate is not a function`) and every request 500s. The
 * Credentials provider — the only part that needs the DB — lives in
 * auth.ts, which is imported only by Node-runtime code (route handlers,
 * server components, server actions).
 */
export const authConfig = {
  // Railway runs behind a proxy; trust the forwarded host headers.
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt' },
  // Unauthenticated middleware hits land here instead of the default
  // NextAuth sign-in page.
  pages: { signIn: '/login' },
  providers: [],
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
} satisfies NextAuthConfig;
