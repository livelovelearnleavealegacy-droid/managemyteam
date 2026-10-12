'use client';

/**
 * Task template list (manager+): table with edit + delete (confirm),
 * and a modal hosting TemplateForm for create/edit.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, EmptyState, Modal, Toast } from '@/components/ui';
import { deleteTemplate } from '@/app/(app)/tasks/templates/actions';
import TemplateForm from './TemplateForm';
import type { TemplateRow, TemplatesData } from './types';

export default function TemplatesClient({ data }: { data: TemplatesData }) {
  const router = useRouter();
  const [editing, setEditing] = useState<TemplateRow | 'new' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string | null;
    tone: 'info' | 'success' | 'error';
  }>({ message: null, tone: 'info' });

  function showToast(message: string, tone: 'info' | 'success' | 'error') {
    setToast({ message, tone });
    window.setTimeout(
      () => setToast((t) => (t.message === message ? { ...t, message: null } : t)),
      5000
    );
  }

  async function handleDelete(t: TemplateRow) {
    const ok = window.confirm(
      `Delete “${t.title}”? Its instance history (pushes and completions) will be deleted too. This cannot be undone.`
    );
    if (!ok) return;
    setDeletingId(t.id);
    try {
      const result = await deleteTemplate(t.id);
      showToast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed.', 'error');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="button" onClick={() => setEditing('new')}>
          + New template
        </Button>
      </div>

      {data.templates.length === 0 ? (
        <EmptyState
          title="No task templates yet"
          body="Create one to start generating task instances on the board."
          action={
            <Button type="button" onClick={() => setEditing('new')}>
              + New template
            </Button>
          }
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th>Repeats</th>
                <th>Assigned to</th>
                <th>Steps</th>
                <th>Photo</th>
                <th>Max pushes</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {data.templates.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.title}</strong>
                    {t.categoryName && (
                      <div style={{ color: 'var(--text2)', fontSize: 13 }}>
                        {t.categoryName}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 14 }}>{t.recurrenceLabel}</td>
                  <td style={{ fontSize: 14 }}>
                    {t.assignmentType === 'user'
                      ? (t.assignedUserName ?? '(removed user)')
                      : `${t.assignedTeamName ?? '(removed team)'} team`}
                  </td>
                  <td style={{ fontSize: 14 }}>{t.checklist.length}</td>
                  <td>
                    {t.requirePhoto ? (
                      <Badge tone="teal">Required</Badge>
                    ) : (
                      <span style={{ color: 'var(--text2)' }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 14 }}>
                    {t.maxPushes === null
                      ? `Default (${data.businessDefaultMaxPushes})`
                      : t.maxPushes}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setEditing(t)}
                      aria-label={`Edit template ${t.title}`}
                    >
                      Edit
                    </Button>{' '}
                    <Button
                      variant="danger"
                      type="button"
                      onClick={() => handleDelete(t)}
                      disabled={deletingId === t.id}
                      aria-label={`Delete template ${t.title}`}
                    >
                      {deletingId === t.id ? 'Deleting…' : 'Delete'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={editing === 'new' ? 'New task template' : `Edit: ${editing.title}`}
          onClose={() => setEditing(null)}
        >
          <TemplateForm
            initial={editing === 'new' ? undefined : editing}
            lookups={data}
            onCancel={() => setEditing(null)}
            onSaved={(message, ok) => {
              showToast(message, ok ? 'success' : 'error');
              if (ok) {
                setEditing(null);
                router.refresh();
              }
            }}
          />
        </Modal>
      )}

      <Toast message={toast.message} tone={toast.tone} />
    </div>
  );
}
