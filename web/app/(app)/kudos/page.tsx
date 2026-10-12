import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';
import { Card, EmptyState, TextArea, Select, Button, Field } from '@/components/ui';

interface KudosRow {
  id: string;
  body: string;
  created_at: string;
  from_user_id: string;
  to_user_id: string;
}

interface DirectoryUser {
  id: string;
  name: string;
}

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

async function giveKudos(formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const toUserId = String(formData.get('to_user_id') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (!toUserId || !body) return;
  // No self-kudos (also enforced by a DB check constraint).
  if (toUserId === session.profile.id) return;

  await withUser(session.profile.id, (q) =>
    q(
      `insert into kudos (business_id, from_user_id, to_user_id, body)
       values ($1, $2, $3, $4)`,
      [
        session.profile.business_id,
        session.profile.id,
        toUserId,
        body.slice(0, 1000),
      ]
    )
  );

  revalidatePath('/kudos');
}

export default async function KudosPage() {
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const { rows: kudosRows } = await withUser(session.profile.id, (q) =>
    q(
      `select id, body, created_at, from_user_id, to_user_id
       from kudos
       where business_id = $1
       order by created_at desc limit 100`,
      [session.profile.business_id]
    )
  );
  const kudos: KudosRow[] = kudosRows.map((r) => ({
    id: String(r.id),
    body: String(r.body),
    created_at: toISO(r.created_at),
    from_user_id: String(r.from_user_id),
    to_user_id: String(r.to_user_id),
  }));

  const { rows: userRows } = await withUser(session.profile.id, (q) =>
    q(
      `select id, name from users
       where business_id = $1 and terminated_at is null
       order by name`,
      [session.profile.business_id]
    )
  );
  const users: DirectoryUser[] = userRows.map((u) => ({
    id: String(u.id),
    name: String(u.name),
  }));
  const names = new Map<string, string>(users.map((u) => [u.id, u.name]));
  const recipients = users.filter((u) => u.id !== session.profile.id);

  return (
    <>
      <h1 className="page-title">Kudos</h1>

      <Card style={{ marginTop: 16 }}>
        <h2 className="section-title" style={{ marginBottom: 12 }}>
          Give kudos
        </h2>
        <form action={giveKudos}>
          <Field label="Recipient" htmlFor="kudos-to">
            <Select id="kudos-to" name="to_user_id" required defaultValue="">
              <option value="" disabled>
                Choose a teammate...
              </option>
              {recipients.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Message" htmlFor="kudos-body">
            <TextArea
              id="kudos-body"
              name="body"
              rows={3}
              required
              maxLength={1000}
              placeholder="What did they do well?"
            />
          </Field>
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <Button type="submit">Give kudos</Button>
          </div>
        </form>
      </Card>

      <div style={{ marginTop: 24, display: 'grid', gap: 12 }}>
        {kudos.length === 0 ? (
          <EmptyState
            title="No kudos yet"
            body="Recognize a teammate with the form above."
          />
        ) : (
          kudos.map((k) => (
            <Card key={k.id}>
              <p style={{ margin: '0 0 6px', fontSize: 15 }}>
                <strong>{names.get(k.from_user_id) ?? 'Unknown'}</strong>
                <span style={{ color: 'var(--text2)' }}> gave kudos to </span>
                <strong>{names.get(k.to_user_id) ?? 'Unknown'}</strong>
              </p>
              <div style={{ whiteSpace: 'pre-wrap' }}>{k.body}</div>
              <p
                style={{
                  color: 'var(--text2)',
                  fontSize: 12,
                  margin: '8px 0 0',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {fmtDateTime(k.created_at)}
              </p>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
