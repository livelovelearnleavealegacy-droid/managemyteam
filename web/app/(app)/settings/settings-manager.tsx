'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  Field,
  Select,
  TextInput,
  Toast,
} from '@/components/ui';
import {
  createCategory,
  deleteCategory,
  renameCategory,
  updateBusinessName,
  updateDefaultMaxPushes,
  updateDigestSchedule,
} from './actions';
import type { BusinessSettings, CategoryRow } from './page';

const COMMON_TIMEZONES = [
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

type Result = { ok: true } | { ok: false; error: string };

export default function SettingsManager({
  business,
  categories,
  activeCount,
  billingNotice,
  adminEmail,
}: {
  business: BusinessSettings;
  categories: CategoryRow[];
  activeCount: number;
  billingNotice: string | null;
  adminEmail: string;
}) {
  const router = useRouter();
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'success' | 'error' } | null>(
    billingNotice ? { message: billingNotice, tone: 'info' } : null
  );
  const [busy, setBusy] = useState<string | null>(null);

  const [bizName, setBizName] = useState(business.name);
  const [maxPushes, setMaxPushes] = useState(String(business.default_max_pushes));
  const [digestEnabled, setDigestEnabled] = useState(business.digest_schedule.enabled);
  const [digestTime, setDigestTime] = useState(business.digest_schedule.time);
  const [digestTz, setDigestTz] = useState(business.digest_schedule.timezone);
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<CategoryRow | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [billingBusy, setBillingBusy] = useState(false);

  function notify(message: string, tone: 'info' | 'success' | 'error') {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 6000);
  }

  async function run(
    key: string,
    fn: () => Promise<Result>,
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

  async function billingAction(path: string, label: string) {
    setBillingBusy(true);
    try {
      const res = await fetch(path, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(data.error ?? 'Could not start ' + label, 'error');
        return;
      }
      if (!data.url) {
        notify('No billing URL returned', 'error');
        return;
      }
      window.location.href = data.url;
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Something went wrong', 'error');
    } finally {
      setBillingBusy(false);
    }
  }

  const subscribed = Boolean(business.stripe_subscription_id);
  const billedCount = Math.max(10, activeCount);
  const estimate = billedCount * 1;
  const trialEnd = business.trial_ends_at ? new Date(business.trial_ends_at) : null;
  const daysRemaining =
    trialEnd != null
      ? Math.max(
          0,
          Math.ceil((trialEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        )
      : null;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <Toast message={toast?.message ?? null} tone={toast?.tone ?? 'info'} />

      {/* Business profile */}
      <Card>
        <h2 className="section-title">Business profile</h2>
        <Field label="Business name" htmlFor="biz-name">
          <TextInput
            id="biz-name"
            value={bizName}
            onChange={(e) => setBizName(e.target.value)}
          />
        </Field>
        <Button
          variant="primary"
          disabled={busy === 'biz'}
          onClick={() =>
            run('biz', () => updateBusinessName(bizName), 'Business name saved.')
          }
        >
          {busy === 'biz' ? 'Saving…' : 'Save'}
        </Button>
      </Card>

      {/* Task defaults */}
      <Card>
        <h2 className="section-title">Task defaults</h2>
        <Field label="Default max pushes" htmlFor="max-pushes">
          <TextInput
            id="max-pushes"
            type="number"
            min={0}
            step={1}
            value={maxPushes}
            onChange={(e) => setMaxPushes(e.target.value)}
          />
        </Field>
        <p style={{ color: 'var(--text2)', marginTop: -8, marginBottom: 12 }}>
          Applies to new task templates only — it is not retroactive.
        </p>
        <Button
          variant="primary"
          disabled={busy === 'pushes'}
          onClick={() =>
            run(
              'pushes',
              () => updateDefaultMaxPushes(Number(maxPushes)),
              'Task default saved.'
            )
          }
        >
          {busy === 'pushes' ? 'Saving…' : 'Save'}
        </Button>
      </Card>

      {/* Categories */}
      <Card>
        <h2 className="section-title">Categories</h2>
        {categories.length === 0 ? (
          <p style={{ color: 'var(--text2)' }}>No categories yet.</p>
        ) : (
          <table className="tbl" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingCategory(c);
                        setEditingCategoryName(c.name);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy === 'delcat:' + c.id}
                      onClick={() =>
                        run(
                          'delcat:' + c.id,
                          () => deleteCategory(c.id),
                          'Category "' + c.name + '" was deleted.'
                        )
                      }
                    >
                      {busy === 'delcat:' + c.id ? 'Deleting…' : 'Delete'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <TextInput
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New category name"
            aria-label="New category name"
            style={{ flex: 1 }}
          />
          <Button
            variant="primary"
            disabled={busy === 'addcat'}
            onClick={() => {
              const name = newCategory.trim();
              run('addcat', () => createCategory(name), 'Category "' + name + '" was created.').then(
                () => setNewCategory('')
              );
            }}
          >
            {busy === 'addcat' ? 'Adding…' : 'Add category'}
          </Button>
        </div>
        {editingCategory && (
          <div
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: '1px solid var(--panel2)',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-end',
            }}
          >
            <div style={{ flex: 1 }}>
              <Field label="Rename category" htmlFor="cat-rename">
                <TextInput
                  id="cat-rename"
                  value={editingCategoryName}
                  onChange={(e) => setEditingCategoryName(e.target.value)}
                />
              </Field>
            </div>
            <Button
              variant="primary"
              disabled={busy === 'rencat'}
              onClick={() => {
                const c = editingCategory;
                setEditingCategory(null);
                run(
                  'rencat',
                  () => renameCategory(c.id, editingCategoryName),
                  'Category renamed.'
                );
              }}
            >
              {busy === 'rencat' ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" onClick={() => setEditingCategory(null)}>
              Cancel
            </Button>
          </div>
        )}
      </Card>

      {/* Shift digest schedule */}
      <Card>
        <h2 className="section-title">Shift digest schedule</h2>
        <label
          style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}
        >
          <input
            type="checkbox"
            checked={digestEnabled}
            onChange={(e) => setDigestEnabled(e.target.checked)}
          />
          Send the shift digest
        </label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px' }}>
            <Field label="Time" htmlFor="digest-time">
              <TextInput
                id="digest-time"
                type="time"
                value={digestTime}
                onChange={(e) => setDigestTime(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <Field label="Timezone" htmlFor="digest-tz">
              <Select
                id="digest-tz"
                value={COMMON_TIMEZONES.includes(digestTz) ? digestTz : 'custom'}
                onChange={(e) => {
                  if (e.target.value !== 'custom') setDigestTz(e.target.value);
                }}
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
                {!COMMON_TIMEZONES.includes(digestTz) && (
                  <option value="custom">{digestTz} (custom)</option>
                )}
              </Select>
            </Field>
          </div>
        </div>
        {!COMMON_TIMEZONES.includes(digestTz) && (
          <Field label="Custom timezone" htmlFor="digest-tz-custom">
            <TextInput
              id="digest-tz-custom"
              value={digestTz}
              onChange={(e) => setDigestTz(e.target.value)}
              placeholder="America/Chicago"
            />
          </Field>
        )}
        <Button
          variant="primary"
          disabled={busy === 'digest'}
          onClick={() =>
            run(
              'digest',
              () =>
                updateDigestSchedule({
                  enabled: digestEnabled,
                  time: digestTime,
                  timezone: digestTz,
                }),
              'Digest schedule saved.'
            )
          }
        >
          {busy === 'digest' ? 'Saving…' : 'Save schedule'}
        </Button>
      </Card>

      {/* Billing */}
      <Card>
        <h2 className="section-title">Billing</h2>
        <table className="tbl" style={{ marginBottom: 16 }}>
          <tbody>
            <tr>
              <td>Plan</td>
              <td>
                $1 per employee per month, minimum 10 employees
              </td>
            </tr>
            <tr>
              <td>Trial</td>
              <td>
                {trialEnd
                  ? daysRemaining + ' days remaining (ends ' + trialEnd.toLocaleDateString() + ')'
                  : 'No trial date set'}
              </td>
            </tr>
            <tr>
              <td>Active employees</td>
              <td>{activeCount}</td>
            </tr>
            <tr>
              <td>Monthly estimate</td>
              <td>
                ${estimate.toFixed(2)} / month ({billedCount} billed employees)
              </td>
            </tr>
            <tr>
              <td>Status</td>
              <td>{subscribed ? 'Subscribed' : 'Trial — no subscription yet'}</td>
            </tr>
          </tbody>
        </table>
        {subscribed ? (
          <Button
            variant="primary"
            disabled={billingBusy}
            onClick={() => billingAction('/api/stripe/portal', 'billing portal')}
          >
            {billingBusy ? 'Opening…' : 'Manage billing'}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={billingBusy}
            onClick={() => billingAction('/api/stripe/checkout', 'checkout')}
          >
            {billingBusy ? 'Opening…' : 'Start subscription'}
          </Button>
        )}
        {!subscribed && (
          <p style={{ color: 'var(--text2)', marginTop: 12 }}>
            Signed in as {adminEmail}. Checkout starts your subscription with
            a trial through the date above — no card required upfront.
          </p>
        )}
      </Card>
    </div>
  );
}
