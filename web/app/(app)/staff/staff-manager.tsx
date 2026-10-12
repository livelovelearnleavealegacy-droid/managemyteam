'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  Select,
  TextInput,
  Toast,
} from '@/components/ui';
import { todayLocal } from '@/lib/format';
import type { StaffUser, TeamRow } from './page';

type RoleTone = 'gold' | 'teal' | 'neutral';

const ROLE_TONE: Record<string, RoleTone> = {
  admin: 'gold',
  manager: 'teal',
  staff: 'neutral',
};

async function postAction(payload: Record<string, unknown>) {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? 'Something went wrong');
  }
  return data;
}

export default function StaffManager({
  initialUsers,
  teams,
  memberships,
  selfId,
}: {
  initialUsers: StaffUser[];
  teams: TeamRow[];
  memberships: Record<string, string[]>;
  selfId: string;
}) {
  const router = useRouter();
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'success' | 'error' } | null>(
    null
  );
  const [busy, setBusy] = useState<string | null>(null);

  // Add-person form state.
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Terminate modal state.
  const [terminating, setTerminating] = useState<StaffUser | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(todayLocal());

  // Delete confirm state.
  const [deleting, setDeleting] = useState<StaffUser | null>(null);

  function notify(message: string, tone: 'info' | 'success' | 'error') {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 6000);
  }

  async function run(key: string, fn: () => Promise<void>, ok: string) {
    setBusy(key);
    try {
      await fn();
      notify(ok, 'success');
      router.refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  }

  function toggleTeam(id: string) {
    setTeamIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleAdd() {
    setFormError(null);
    setBusy('add');
    try {
      await postAction({
        action: 'create',
        name,
        email,
        password,
        role,
        teamIds,
      });
      setShowAdd(false);
      setName('');
      setEmail('');
      setPassword('');
      setRole('staff');
      setTeamIds([]);
      notify(name.trim() + ' was added to staff.', 'success');
      router.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  const active = initialUsers.filter((u) => !u.terminated_at);
  const terminated = initialUsers.filter((u) => u.terminated_at);

  return (
    <div>
      <Toast message={toast?.message ?? null} tone={toast?.tone ?? 'info'} />

      <div style={{ margin: '16px 0' }}>
        <Button variant="primary" onClick={() => setShowAdd(true)}>
          Add person
        </Button>
      </div>

      <h2 className="section-title">Active ({active.length})</h2>
      {active.length === 0 ? (
        <EmptyState title="No active staff" body="Add someone to get started." />
      ) : (
        <table className="tbl" style={{ marginBottom: 32 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Teams</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {active.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <Badge tone={ROLE_TONE[u.role] ?? 'neutral'}>{u.role}</Badge>
                </td>
                <td>{(memberships[u.id] ?? []).join(', ') || '—'}</td>
                <td>
                  {u.id === selfId ? (
                    <span style={{ color: 'var(--text2)' }}>This is you</span>
                  ) : (
                    <Button
                      variant="danger"
                      onClick={() => {
                        setTerminating(u);
                        setEffectiveDate(todayLocal());
                      }}
                    >
                      Terminate
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {terminated.length > 0 && (
        <>
          <h2 className="section-title">Terminated ({terminated.length})</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Effective</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {terminated.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <Badge tone={ROLE_TONE[u.role] ?? 'neutral'}>{u.role}</Badge>
                  </td>
                  <td>{u.termination_effective_date ?? '—'}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <Button
                      variant="ghost"
                      disabled={busy === 'reactivate:' + u.id}
                      onClick={() =>
                        run(
                          'reactivate:' + u.id,
                          () => postAction({ action: 'reactivate', userId: u.id }).then(() => {}),
                          u.name + ' was reactivated. They were not re-added to their old teams; add them back on the Teams page if needed.'
                        )
                      }
                    >
                      {busy === 'reactivate:' + u.id ? 'Working…' : 'Reactivate'}
                    </Button>
                    <Button variant="danger" onClick={() => setDeleting(u)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Add person modal */}
      {showAdd && (
        <Modal title="Add person" onClose={() => setShowAdd(false)}>
          <Field label="Full name" htmlFor="staff-name">
            <TextInput
              id="staff-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jordan Lee"
            />
          </Field>
          <Field label="Email" htmlFor="staff-email">
            <TextInput
              id="staff-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jordan@example.com"
            />
          </Field>
          <Field label="Temporary password" htmlFor="staff-password">
            <TextInput
              id="staff-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </Field>
          <Field label="Role" htmlFor="staff-role">
            <Select
              id="staff-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          {teams.length > 0 && (
            <Field label="Teams">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {teams.map((t) => (
                  <label key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={teamIds.includes(t.id)}
                      onChange={() => toggleTeam(t.id)}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          {formError && (
            <p className="form-error" role="status">
              {formError}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="primary"
              disabled={busy === 'add'}
              onClick={handleAdd}
            >
              {busy === 'add' ? 'Adding…' : 'Add person'}
            </Button>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {/* Terminate modal */}
      {terminating && (
        <Modal
          title={'Terminate ' + terminating.name}
          onClose={() => setTerminating(null)}
        >
          <p style={{ color: 'var(--text2)' }}>
            Termination takes effect on the date you pick. Billing is prorated
            by days active.
          </p>
          <Field label="Effective date (today or up to 30 days out)" htmlFor="term-date">
            <TextInput
              id="term-date"
              type="date"
              value={effectiveDate}
              min={todayLocal()}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="danger"
              disabled={busy === 'terminate'}
              onClick={() => {
                const u = terminating;
                setTerminating(null);
                run(
                  'terminate',
                  () =>
                    postAction({
                      action: 'terminate',
                      userId: u.id,
                      effectiveDate,
                    }).then(() => {}),
                  u.name + ' was terminated, effective ' + effectiveDate + '.'
                );
              }}
            >
              {busy === 'terminate' ? 'Working…' : 'Terminate'}
            </Button>
            <Button variant="ghost" onClick={() => setTerminating(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleting && (
        <Modal title={'Delete ' + deleting.name} onClose={() => setDeleting(null)}>
          <p style={{ color: 'var(--text2)' }}>
            Deletion is permanent and removes their login. Only terminated
            staff can be deleted.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="danger"
              disabled={busy === 'delete'}
              onClick={() => {
                const u = deleting;
                setDeleting(null);
                run(
                  'delete',
                  () => postAction({ action: 'delete', userId: u.id }).then(() => {}),
                  u.name + ' was deleted.'
                );
              }}
            >
              {busy === 'delete' ? 'Working…' : 'Delete permanently'}
            </Button>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {/* Spacer so the last-admin error copy is visible in context */}
      <Card style={{ marginTop: 32 }}>
        <h3 className="section-title">About removing admins</h3>
        <p style={{ color: 'var(--text2)' }}>
          A business always needs at least one active admin. If you try to
          terminate the last active admin, the request is blocked — make
          someone else an admin first.
        </p>
      </Card>
    </div>
  );
}
