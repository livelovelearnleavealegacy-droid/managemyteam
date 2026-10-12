/**
 * Shared shapes for the tasks workstream (board + templates).
 * Serialized from the server components; consumed by client components.
 */
import type { TaskStatus } from '@/lib/delinquency';

export interface ChecklistItem {
  label: string;
}

export interface BoardInstance {
  templateId: string;
  instanceKey: string;
  originalDate: string;
  effectiveDate: string;
  pushCount: number;
  maxPushes: number;
  status: TaskStatus;
  completed: boolean;
  completedByName: string | null;
  photoPath: string | null;
  title: string;
  description: string;
  categoryName: string | null;
  requirePhoto: boolean;
  checklist: ChecklistItem[];
  assigneeNames: string[];
  assignedUserId: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
}

export interface BoardData {
  instances: BoardInstance[];
  isManager: boolean;
  businessId: string;
  staffOptions: { id: string; name: string }[];
  teamMembership: { userId: string; teamId: string }[];
  templateOptions: { id: string; title: string }[];
  businessDefaultMaxPushes: number;
  today: string;
}

export interface TemplateRow {
  id: string;
  title: string;
  description: string;
  checklist: ChecklistItem[];
  requirePhoto: boolean;
  categoryId: string | null;
  categoryName: string | null;
  assignmentType: 'user' | 'team';
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  recurrence: unknown;
  recurrenceLabel: string;
  maxPushes: number | null;
}

export interface TemplatesData {
  templates: TemplateRow[];
  categories: { id: string; name: string }[];
  users: { id: string; name: string; role: string; terminatedAt: string | null }[];
  teams: { id: string; name: string; memberCount: number }[];
  businessDefaultMaxPushes: number;
}
