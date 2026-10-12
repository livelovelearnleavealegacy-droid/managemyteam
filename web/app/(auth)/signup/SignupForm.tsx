'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { SignupState } from './page';

export default function SignupForm({
  action,
}: {
  action: (prev: SignupState, formData: FormData) => Promise<SignupState>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // On success the server action signs the user in and redirects to
      // /overview; on failure it returns { error }.
      const result = await action({}, new FormData(e.currentTarget));
      if (result?.error) setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit}>
        <div className="field-row">
          <label className="label" htmlFor="businessName">
            Business name
          </label>
          <input
            className="input"
            id="businessName"
            name="businessName"
            type="text"
            autoComplete="organization"
            required
          />
        </div>
        <div className="field-row">
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input
            className="input"
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
          />
        </div>
        <div className="field-row">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
        <div className="field-row">
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Creating account...' : 'Create account'}
        </button>
        {error && <p className="form-error">{error}</p>}
      </form>
      <p className="auth-foot">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
