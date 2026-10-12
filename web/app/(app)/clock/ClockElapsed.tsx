'use client';

import { useEffect, useState } from 'react';

function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [String(m).padStart(2, '0'), String(s).padStart(2, '0')];
  if (h > 0) parts.unshift(String(h));
  return parts.join(':');
}

export default function ClockElapsed({ clockIn }: { clockIn: string }) {
  const start = new Date(clockIn).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <span role="status" style={{ fontFamily: 'var(--font-mono)' }}>
      {fmtElapsed(now - start)} elapsed
    </span>
  );
}
