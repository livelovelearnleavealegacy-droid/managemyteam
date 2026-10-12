'use client';

/**
 * Task board: filterable instance list with Push / Complete actions.
 * Managers additionally filter by staff member and template.
 * Staff actions are re-checked server-side (assignment visibility).
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState, Field, Select, Toast } from '@/components/ui';
import { pushInstance } from '@/app/(app)/tasks/actions';
import type { TaskStatus } from '@/lib/delinquency';
import InstanceCard from './InstanceCard';
import CompleteDialog from './CompleteDialog';
import type { BoardData, BoardInstance } from './types';

type StatusFilter = 'all' | TaskStatus;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'delinquent', label: 'Delinquent' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due-today', label: 'Due today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
];

export default function BoardClient({ data }: { data: BoardData }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [templateFilter, setTemplateFilter] = useState<string>('all');
  const [pushingKey, setPushingKey] = useState<string | null>(null);
  const [completing, setCompleting] = useState<BoardInstance | null>(null);
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

  // userId → teamIds, for the manager staff filter (a person matches
  // instances assigned to them directly or to one of their teams).
  const userTeams = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const t of data.teamMembership) {
      const s = m.get(t.userId) ?? new Set<string>();
      s.add(t.teamId);
      m.set(t.userId, s);
    }
    return m;
  }, [data.teamMembership]);

  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = {
      completed: 0,
      delinquent: 0,
      overdue: 0,
      'due-today': 0,
      upcoming: 0,
    };
    for (const i of data.instances) c[i.status] += 1;
    return c;
  }, [data.instances]);

  const filtered = useMemo(() => {
    return data.instances.filter((i) => {
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      if (templateFilter !== 'all' && i.templateId !== templateFilter)
        return false;
      if (staffFilter !== 'all') {
        const teams = userTeams.get(staffFilter);
        const direct = i.assignedUserId === staffFilter;
        const viaTeam =
          i.assignedTeamId !== null && teams !== undefined
            ? teams.has(i.assignedTeamId)
            : false;
        if (!direct && !viaTeam) return false;
      }
      return true;
    });
  }, [data.instances, statusFilter, staffFilter, templateFilter, userTeams]);

  async function handlePush(instance: BoardInstance) {
    setPushingKey(instance.instanceKey);
    try {
      const result = await pushInstance(
        instance.templateId,
        instance.instanceKey,
        instance.originalDate
      );
      showToast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) router.refresh();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Push failed.',
        'error'
      );
    } finally {
      setPushingKey(null);
    }
  }

  if (data.instances.length === 0) {
    return (
      <EmptyState
        title="No tasks in view"
        body={
          data.isManager
            ? 'Create a task template to generate instances.'
            : 'Nothing assigned to you in the current window (past 14 days → next 60 days).'
        }
      />
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 20,
        }}
      >
        <Field label="Status" htmlFor="filter-status">
          <Select
            id="filter-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {o.value !== 'all' ? ` (${counts[o.value]})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        {data.isManager && (
          <Field label="Staff" htmlFor="filter-staff">
            <Select
              id="filter-staff"
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
            >
              <option value="all">Everyone</option>
              {data.staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {data.isManager && (
          <Field label="Template" htmlFor="filter-template">
            <Select
              id="filter-template"
              value={templateFilter}
              onChange={(e) => setTemplateFilter(e.target.value)}
            >
              <option value="all">All templates</option>
              {data.templateOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No instances match"
          body="Try widening the filters."
        />
      ) : (
        filtered.map((i) => (
          <InstanceCard
            key={i.instanceKey}
            instance={i}
            pushing={pushingKey === i.instanceKey}
            onPush={handlePush}
            onComplete={setCompleting}
          />
        ))
      )}

      {completing && (
        <CompleteDialog
          instance={completing}
          businessId={data.businessId}
          onClose={() => setCompleting(null)}
          onDone={(message, ok) => {
            showToast(message, ok ? 'success' : 'error');
            if (ok) router.refresh();
          }}
        />
      )}

      <Toast message={toast.message} tone={toast.tone} />
    </div>
  );
}
