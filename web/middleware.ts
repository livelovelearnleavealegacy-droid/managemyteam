import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Edge middleware built ONLY from the edge-safe config (auth.config.ts).
// Do NOT re-export `auth` from '@/auth' here: auth.ts imports the Postgres
// driver (`pg` via @/lib/db), which cannot load in the Edge runtime and
// 500s every request. The `authorized` callback in auth.config.ts decides:
//  - signed out: /login and /signup are public, everything else -> /login
//  - signed in:  /login, /signup, / land on /overview
// /api/auth/* is excluded so the Auth.js route handlers run untouched.
const { auth } = NextAuth(authConfig);

export const middleware = auth;
export default auth;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
