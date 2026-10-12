'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';

/**
 * Manual refresh for the message list.
 * v0.1 has no realtime channel subscriptions, so users tap Refresh to pull
 * newly posted messages. A future version can swap this for a realtime
 * subscription on the chat_messages table.
 */
export default function RefreshButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={() => router.refresh()}
      aria-label="Refresh messages"
      type="button"
    >
      Refresh
    </Button>
  );
}
