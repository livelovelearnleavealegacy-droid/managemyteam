// Auth.js v5 middleware. The `authorized` callback in auth.ts decides:
//  - signed out: /login and /signup are public, everything else -> /login
//  - signed in:  /login, /signup, / land on /overview
// /api/auth/* is excluded so the Auth.js route handlers run untouched.
export { auth as middleware } from '@/auth';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
