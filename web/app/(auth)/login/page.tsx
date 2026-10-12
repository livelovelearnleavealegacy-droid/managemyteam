'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await signIn('credentials', {
        redirect: false,
        email: email.trim(),
        password,
      });
      if (result?.error) {
        setError('Invalid email or password. Please try again.');
        return;
      }
      router.push('/overview');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">managemyteam.io</h1>
      <p className="auth-sub">Sign in to your team account</p>
      <form onSubmit={onSubmit}>
        <div className="field-row">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            className="input"
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field-row">
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            className="input"
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
        {error && <p className="form-error">{error}</p>}
      </form>
      <p className="auth-foot">
        New here? <Link href="/signup">Create your business account</Link>
      </p>
    </>
  );
}
