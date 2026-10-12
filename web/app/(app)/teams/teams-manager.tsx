'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  TextInput,
  Toast,
} from '@/components/ui';
import { createTeam, deleteTeam, renameTeam, setTeamMembers } from './actions';
import type { MemberRow, StaffOption, TeamRow } from './page';

export default function TeamsManager({
  initialTeams,
  users,
  initialMembers,
}: {
  initialTeams: TeamRow[];
  users: StaffOption[];
  initialMembers: MemberRow[];
}) {
  const router = useRouter();
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'success' | 'error' } | null>(
    null
  );
  const [busy, setBusy] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<TeamRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<TeamRow | null>(null);
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  // Draft membership checkboxes per team, keyed by team id.
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});

  function notify(message: string, tone: 'info' | 'success' | 'error') {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 6000);
  }

  function membersOf(teamId: string): string[] {
    if (drafts[teamId]) return drafts[teamId];
    return initialMembers.filter((m) => m.team_id === teamId).map((m) => m.user_id);
  }

  async function run(
    key: string,
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    okMessage: string
  ) {
    setBusy(key);
    try {
      const result = await fn();
      if (!result.ok) {
        notify(result.error, 'error');
        return;
      }
      notify(okMessage, 'success');
      router.refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <Toast message={toast?.message ?? null} tone={toast?.tone ?? 'info'} />

      <Card style={{ marginBottom: 24, maxWidth: 520 }}>
        <h2 className="section-title">New team</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <TextInput
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Team name"
            aria-label="New team name"
            style={{ flex: 1 }}
          />
          <Button
            variant="primary"
            disabled={busy === 'create'}
            onClick={() => {
              const name = newName.trim();
              run('create', () => createTeam(name), 'Team "' + name + '" was created.').then(
                () => setNewName('')
              );
            }}
          >
            {busy === 'create' ? 'Creating…' : 'Create team'}
          </Button>
        </div>
      </Card>

      {initialTeams.length === 0 ? (
        <EmptyState
          title="No teams yet"
          body="Create your first team above, then assign members."
        />
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {initialTeams.map((team) => {
            const memberIds = membersOf(team.id);
            const dirty = drafts[team.id] !== undefined;
            return (
              <Card key={team.id}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <h2 className="section-title" style={{ margin: 0 }}>
                    {team.name}
                  </h2>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRenaming(team);
                        setRenameValue(team.name);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setOpenTeamId(openTeamId === team.id ? null : team.id)
                      }
                      aria-expanded={openTeamId === team.id}
                    >
                      {openTeamId === team.id ? 'Hide members' : 'Members (' + memberIds.length + ')'}
                    </Button>
                    <Button variant="danger" onClick={() => setDeleting(team)}>
                      Delete
                    </Button>
                  </div>
                </div>

                {openTeamId === team.id && (
                  <div style={{ marginTop: 16 }}>
                    {users.length === 0 ? (
                      <p style={{ color: 'var(--text2)' }}>
                        No active staff to assign yet.
                      </p>
                    ) : (
                      <>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns:
                              'repeat(auto-fill, minmax(220px, 1fr))',
                            gap: 8,
                          }}
                        >
                          {users.map((u) => (
                            <label
                              key={u.id}
                              style={{
                                display: 'flex',
                                gap: 8,
                                alignItems: 'center',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={memberIds.includes(u.id)}
                                onChange={() => {
                                  const next = memberIds.includes(u.id)
                                    ? memberIds.filter((id) => id !== u.id)
                                    : [...memberIds, u.id];
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [team.id]: next,
                                  }));
                                }}
                              />
                              {u.name}
                            </label>
                          ))}
                        </div>
                        {dirty && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <Button
                              variant="primary"
                              disabled={busy === 'save:' + team.id}
                              onClick={() =>
                                run(
                                  'save:' + team.id,
                                  () => setTeamMembers(team.id, memberIds),
                                  'Members updated for "' + team.name + '".'
                                )
                              }
                            >
                              {busy === 'save:' + team.id ? 'Saving…' : 'Save members'}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                setDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[team.id];
                                  return next;
                                })
                              }
                            >
                              Discard
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Rename modal */}
      {renaming && (
        <Modal title={'Rename ' + renaming.name} onClose={() => setRenaming(null)}>
          <Field label="Team name" htmlFor="rename-team">
            <TextInput
              id="rename-team"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="primary"
              disabled={busy === 'rename'}
              onClick={() => {
                const team = renaming;
                setRenaming(null);
                run(
                  'rename',
                  () => renameTeam(team.id, renameValue),
                  'Team renamed to "' + renameValue.trim() + '".'
                );
              }}
            >
              {busy === 'rename' ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleting && (
        <Modal title={'Delete ' + deleting.name} onClose={() => setDeleting(null)}>
          <p style={{ color: 'var(--text2)' }}>
            This removes the team and its member list. A team with chat
            history cannot be deleted while those messages exist.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="danger"
              disabled={busy === 'delete'}
              onClick={() => {
                const team = deleting;
                setDeleting(null);
                run(
                  'delete',
                  () => deleteTeam(team.id),
                  'Team "' + team.name + '" was deleted.'
                );
              }}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete team'}
            </Button>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
