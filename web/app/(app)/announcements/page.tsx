import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';
import { Card, EmptyState, TextInput, TextArea, Button, Field } from '@/components/ui';
import DeleteButton from './DeleteButton';

interface Announcement {
  id: string;
  title: string | null;
  body: string;
  created_at: string;
  user_id: string;
}

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function isManagerPlus(role: string): boolean {
  return role === 'admin' || role === 'manager';
}

async function createAnnouncement(formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session || !isManagerPlus(session.profile.role)) redirect('/login');

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return;

  await withUser(session.profile.id, (q) =>
    q(
      `insert into announcements (business_id, user_id, title, body)
       values ($1, $2, $3, $4)`,
      [
        session.profile.business_id,
        session.profile.id,
        title ? title.slice(0, 200) : null,
        body.slice(0, 5000),
      ]
    )
  );

  revalidatePath('/announcements');
}

async function deleteAnnouncement(id: string) {
  'use server';
  const session = await getSessionUser();
  // Delete is admin-only (enforced here and by RLS).
  if (!session || session.profile.role !== 'admin') redirect('/login');

  await withUser(session.profile.id, (q) =>
    q('delete from announcements where id = $1 and business_id = $2', [
      id,
      session.profile.business_id,
    ])
  );

  revalidatePath('/announcements');
}

export default async function AnnouncementsPage() {
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const canCompose = isManagerPlus(session.profile.role);
  const isAdmin = session.profile.role === 'admin';

  const { rows } = await withUser(session.profile.id, (q) =>
    q(
      `select id, title, body, created_at, user_id
       from announcements
       where business_id = $1
       order by created_at desc limit 100`,
      [session.profile.business_id]
    )
  );
  const announcements: Announcement[] = rows.map((r) => ({
    id: String(r.id),
    title: r.title == null ? null : String(r.title),
    body: String(r.body),
    created_at: toISO(r.created_at),
    user_id: String(r.user_id),
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
      <h1 className="page-title">Announcements</h1>

      {canCompose && (
        <Card style={{ marginTop: 16 }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            New announcement
          </h2>
          <form action={createAnnouncement}>
            <Field label="Title" htmlFor="ann-title">
              <TextInput
                id="ann-title"
                name="title"
                maxLength={200}
                placeholder="Announcement title"
              />
            </Field>
            <Field label="Message" htmlFor="ann-body">
              <TextArea
                id="ann-body"
                name="body"
                rows={4}
                required
                maxLength={5000}
                placeholder="What should the team know?"
              />
            </Field>
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button type="submit">Post announcement</Button>
            </div>
          </form>
        </Card>
      )}

      <div style={{ marginTop: 24, display: 'grid', gap: 12 }}>
        {announcements.length === 0 ? (
          <EmptyState
            title="No announcements yet"
            body={
              canCompose
                ? 'Post the first announcement with the form above.'
                : 'Check back later — managers will post announcements here.'
            }
          />
        ) : (
          announcements.map((a) => (
            <Card key={a.id}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  {a.title && (
                    <h2 className="section-title" style={{ marginBottom: 4 }}>
                      {a.title}
                    </h2>
                  )}
                  <p style={{ color: 'var(--text2)', fontSize: 13, margin: '0 0 8px' }}>
                    {names.get(a.user_id) ?? 'Unknown'} ·{' '}
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {fmtDateTime(a.created_at)}
                    </span>
                  </p>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>
                </div>
                {isAdmin && (
                  <DeleteButton
                    action={deleteAnnouncement.bind(null, a.id)}
                    label="Delete"
                    itemName="announcement"
                  />
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
