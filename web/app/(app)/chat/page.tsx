import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';
import { Card, EmptyState, TextArea, Button, Field } from '@/components/ui';
import RefreshButton from './RefreshButton';

const EVERYONE = 'everyone';

interface TeamChannel {
  id: string;
  name: string;
}

interface ChatMessage {
  id: string;
  body: string;
  created_at: string;
  user_id: string;
}

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/** Post a message into the current channel. Runs as a server action. */
async function postMessage(teamId: string, formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const body = String(formData.get('body') ?? '').trim();
  if (!body) return;

  // Staff can only see their own teams + Everyone. The insert RLS policy has
  // no team-membership check, so enforce it here at the app layer.
  if (session.profile.role === 'staff' && teamId !== EVERYONE) {
    const { rows } = await withUser(session.profile.id, (q) =>
      q(
        'select 1 from team_members where team_id = $1 and user_id = $2 limit 1',
        [teamId, session.profile.id]
      )
    );
    if (!rows[0]) return;
  }

  await withUser(session.profile.id, (q) =>
    q(
      `insert into chat_messages (business_id, team_id, user_id, body)
       values ($1, $2, $3, $4)`,
      [
        session.profile.business_id,
        teamId === EVERYONE ? null : teamId,
        session.profile.id,
        body.slice(0, 2000),
      ]
    )
  );

  revalidatePath('/chat');
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: { team?: string };
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  const isManagerPlus =
    session.profile.role === 'admin' || session.profile.role === 'manager';

  // Channel list: Everyone + teams. Staff only see teams they belong to;
  // manager+ see every team. (Reads are also protected by RLS.)
  const { rows: teamRows } = await withUser(session.profile.id, (q) =>
    q('select id, name from teams where business_id = $1 order by name', [
      session.profile.business_id,
    ])
  );

  let channels: TeamChannel[] = teamRows.map((t) => ({
    id: String(t.id),
    name: String(t.name),
  }));
  if (!isManagerPlus) {
    const { rows: mine } = await withUser(session.profile.id, (q) =>
      q('select team_id from team_members where user_id = $1', [
        session.profile.id,
      ])
    );
    const memberIds = new Set(mine.map((m) => String(m.team_id)));
    channels = channels.filter((t) => memberIds.has(t.id));
  }

  const requested = searchParams.team || EVERYONE;
  const selected = requested === EVERYONE ? EVERYONE : requested;
  if (selected !== EVERYONE && !channels.some((c) => c.id === selected)) {
    redirect('/chat?team=' + EVERYONE);
  }
  const selectedName =
    selected === EVERYONE
      ? 'Everyone'
      : (channels.find((c) => c.id === selected)?.name ?? 'Channel');

  // Messages for the selected channel, oldest first.
  const { rows: messageRows } = await withUser(session.profile.id, (q) =>
    selected === EVERYONE
      ? q(
          `select id, body, created_at, user_id
           from chat_messages
           where business_id = $1 and team_id is null
           order by created_at asc limit 200`,
          [session.profile.business_id]
        )
      : q(
          `select id, body, created_at, user_id
           from chat_messages
           where business_id = $1 and team_id = $2
           order by created_at asc limit 200`,
          [session.profile.business_id, selected]
        )
  );
  const messages: ChatMessage[] = messageRows.map((m) => ({
    id: String(m.id),
    body: String(m.body),
    created_at: toISO(m.created_at),
    user_id: String(m.user_id),
  }));

  const { rows: userRows } = await withUser(session.profile.id, (q) =>
    q('select id, name from users where business_id = $1', [
      session.profile.business_id,
    ])
  );
  const names = new Map<string, string>(
    userRows.map((u) => [String(u.id), String(u.name)])
  );

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <h1 className="page-title">Team chat</h1>
        <RefreshButton />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '220px 1fr',
          gap: 16,
          marginTop: 16,
          alignItems: 'start',
        }}
      >
        {/* Channel list */}
        <Card style={{ padding: 8 }}>
          <p className="label" style={{ padding: '4px 12px' }}>
            Channels
          </p>
          <nav aria-label="Chat channels">
            <Link
              href={'/chat?team=' + EVERYONE}
              aria-current={selected === EVERYONE ? 'page' : undefined}
              className={'nav-link' + (selected === EVERYONE ? ' active' : '')}
              style={{ display: 'block' }}
            >
              Everyone
            </Link>
            {channels.map((c) => (
              <Link
                key={c.id}
                href={'/chat?team=' + c.id}
                aria-current={selected === c.id ? 'page' : undefined}
                className={'nav-link' + (selected === c.id ? ' active' : '')}
                style={{ display: 'block' }}
              >
                {c.name}
              </Link>
            ))}
          </nav>
          {!isManagerPlus && channels.length === 0 && (
            <p style={{ color: 'var(--text2)', fontSize: 13, padding: '4px 12px' }}>
              You are not on any teams yet.
            </p>
          )}
        </Card>

        {/* Message column */}
        <div>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            {selectedName}
          </h2>

          <Card
            aria-live="polite"
            style={{
              maxHeight: 480,
              overflowY: 'auto',
              padding: '16px 20px',
              marginBottom: 16,
            }}
          >
            {messages.length === 0 ? (
              <EmptyState
                title="No messages yet"
                body="Be the first to post in this channel."
              />
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {messages.map((m) => (
                  <li key={m.id} style={{ marginBottom: 14 }}>
                    <div style={{ marginBottom: 2 }}>
                      <strong>{names.get(m.user_id) ?? 'Unknown'}</strong>{' '}
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                          color: 'var(--text2)',
                        }}
                      >
                        {fmtDateTime(m.created_at)}
                      </span>
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Post box */}
          <Card>
            <form action={postMessage.bind(null, selected)}>
              <Field label="New message" htmlFor="chat-body">
                <TextArea
                  id="chat-body"
                  name="body"
                  rows={3}
                  required
                  maxLength={2000}
                  placeholder={'Post a message to ' + selectedName + '...'}
                />
              </Field>
              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <Button type="submit">Send</Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
