import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';
import { Card, EmptyState, TextInput, TextArea, Button, Field } from '@/components/ui';

interface Article {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  user_id: string | null;
}

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function isManagerPlus(role: string): boolean {
  return role === 'admin' || role === 'manager';
}

async function createArticle(formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session || !isManagerPlus(session.profile.role)) redirect('/login');

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!title || !body) return;

  await withUser(session.profile.id, (q) =>
    q(
      `insert into knowledge_articles (business_id, user_id, title, body)
       values ($1, $2, $3, $4)`,
      [session.profile.business_id, session.profile.id, title.slice(0, 200), body.slice(0, 20000)]
    )
  );

  revalidatePath('/knowledge');
}

async function updateArticle(id: string, formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session || !isManagerPlus(session.profile.role)) redirect('/login');

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!title || !body) return;

  await withUser(session.profile.id, (q) =>
    q(
      `update knowledge_articles
       set title = $1, body = $2, updated_at = $3
       where id = $4 and business_id = $5`,
      [
        title.slice(0, 200),
        body.slice(0, 20000),
        new Date().toISOString(),
        id,
        session.profile.business_id,
      ]
    )
  );

  revalidatePath('/knowledge');
}

function excerpt(body: string): string {
  return body.length > 220 ? body.slice(0, 220) + '...' : body;
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: { q?: string; id?: string; edit?: string };
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  const canWrite = isManagerPlus(session.profile.role);

  const { rows } = await withUser(session.profile.id, (q) =>
    q(
      `select id, title, body, created_at, updated_at, user_id
       from knowledge_articles
       where business_id = $1
       order by updated_at desc limit 200`,
      [session.profile.business_id]
    )
  );
  const allArticles: Article[] = rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    body: String(r.body),
    created_at: toISO(r.created_at),
    updated_at: toISO(r.updated_at),
    user_id: r.user_id == null ? null : String(r.user_id),
  }));

  const { rows: userRows } = await withUser(session.profile.id, (q) =>
    q('select id, name from users where business_id = $1', [
      session.profile.business_id,
    ])
  );
  const names = new Map<string, string>(
    userRows.map((u) => [String(u.id), String(u.name)])
  );

  // --- Article detail view (?id=) -------------------------------------------
  const activeId = searchParams.id;
  if (activeId) {
    const article = allArticles.find((a) => a.id === activeId);
    if (!article) redirect('/knowledge');
    const editing = canWrite && searchParams.edit === '1';

    return (
      <>
        <h1 className="page-title">Knowledge base</h1>
        <div style={{ marginTop: 12, marginBottom: 16 }}>
          <Link href="/knowledge" className="btn btn-ghost">
            Back to articles
          </Link>
        </div>

        <Card>
          <h2 className="section-title" style={{ marginBottom: 4 }}>
            {article.title}
          </h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, margin: '0 0 12px' }}>
            {article.user_id ? names.get(article.user_id) ?? 'Unknown' : 'Unknown'} · Updated{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {fmtDateTime(article.updated_at)}
            </span>
          </p>

          {editing ? (
            <form action={updateArticle.bind(null, article.id)}>
              <Field label="Title" htmlFor="kb-edit-title">
                <TextInput
                  id="kb-edit-title"
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={article.title}
                />
              </Field>
              <Field label="Body" htmlFor="kb-edit-body">
                <TextArea
                  id="kb-edit-body"
                  name="body"
                  rows={12}
                  required
                  maxLength={20000}
                  defaultValue={article.body}
                />
              </Field>
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'flex-end',
                }}
              >
                <Link href={'/knowledge?id=' + article.id} className="btn btn-ghost">
                  Cancel
                </Link>
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          ) : (
            <>
              <div style={{ whiteSpace: 'pre-wrap' }}>{article.body}</div>
              {canWrite && (
                <div style={{ marginTop: 16, textAlign: 'right' }}>
                  <Link
                    href={'/knowledge?id=' + article.id + '&edit=1'}
                    className="btn btn-primary"
                  >
                    Edit article
                  </Link>
                </div>
              )}
            </>
          )}
        </Card>
      </>
    );
  }

  // --- List view -------------------------------------------------------------
  const q = (searchParams.q ?? '').trim().toLowerCase();
  const articles = q
    ? allArticles.filter(
        (a) =>
          a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)
      )
    : allArticles;

  return (
    <>
      <h1 className="page-title">Knowledge base</h1>

      <Card style={{ marginTop: 16 }}>
        <form method="get" action="/knowledge">
          <Field label="Search articles" htmlFor="kb-search">
            <div style={{ display: 'flex', gap: 8 }}>
              <TextInput
                id="kb-search"
                name="q"
                defaultValue={searchParams.q ?? ''}
                placeholder="Search by title or content..."
                style={{ flex: 1 }}
              />
              <Button type="submit">Search</Button>
              {q && (
                <Link href="/knowledge" className="btn btn-ghost">
                  Clear
                </Link>
              )}
            </div>
          </Field>
        </form>
      </Card>

      {canWrite && (
        <Card style={{ marginTop: 16 }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            New article
          </h2>
          <form action={createArticle}>
            <Field label="Title" htmlFor="kb-new-title">
              <TextInput
                id="kb-new-title"
                name="title"
                required
                maxLength={200}
                placeholder="Article title"
              />
            </Field>
            <Field label="Body" htmlFor="kb-new-body">
              <TextArea
                id="kb-new-body"
                name="body"
                rows={8}
                required
                maxLength={20000}
                placeholder="Write the article content..."
              />
            </Field>
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button type="submit">Create article</Button>
            </div>
          </form>
        </Card>
      )}

      <div style={{ marginTop: 24, display: 'grid', gap: 12 }}>
        {articles.length === 0 ? (
          <EmptyState
            title={q ? 'No articles match your search' : 'No articles yet'}
            body={
              q
                ? 'Try a different search term.'
                : canWrite
                  ? 'Create the first article with the form above.'
                  : 'Managers have not published any articles yet.'
            }
          />
        ) : (
          articles.map((a) => (
            <Card key={a.id}>
              <Link
                href={'/knowledge?id=' + a.id}
                className="section-title"
                style={{
                  marginBottom: 4,
                  display: 'block',
                  color: 'var(--text)',
                  textDecoration: 'none',
                }}
              >
                {a.title}
              </Link>
              <p style={{ color: 'var(--text2)', fontSize: 13, margin: '0 0 8px' }}>
                {a.user_id ? names.get(a.user_id) ?? 'Unknown' : 'Unknown'} · Updated{' '}
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {fmtDateTime(a.updated_at)}
                </span>
              </p>
              <p style={{ margin: 0, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>
                {excerpt(a.body)}
              </p>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
