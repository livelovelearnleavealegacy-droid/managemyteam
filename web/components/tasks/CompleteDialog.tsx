'use client';

/**
 * Completion dialog: checklist checkboxes (all required) + photo upload when
 * the template requires one. The photo is resized client-side, uploaded via
 * the /api/photos route, and only the storage PATH is recorded —
 * the upload must succeed before the completion is recorded.
 */
import { useState } from 'react';
import { Button, Modal, TextInput } from '@/components/ui';
import { resizeImage, uploadTaskPhoto } from '@/lib/photos';
import { completeInstance } from '@/app/(app)/tasks/actions';
import type { BoardInstance } from './types';

export default function CompleteDialog({
  instance,
  businessId,
  onClose,
  onDone,
}: {
  instance: BoardInstance;
  businessId: string;
  onClose: () => void;
  onDone: (message: string, ok: boolean) => void;
}) {
  const [checked, setChecked] = useState<boolean[]>(
    instance.checklist.map(() => false)
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = checked.every(Boolean);
  const needsPhoto = instance.requirePhoto;

  function toggle(idx: number) {
    setChecked((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      if (instance.checklist.length > 0 && !allChecked) {
        throw new Error('All checklist items must be checked to complete.');
      }

      let photoPath: string | null = null;
      if (needsPhoto) {
        if (!file) throw new Error('A photo is required to complete this task.');
        const blob = await resizeImage(file);
        photoPath = await uploadTaskPhoto(
          businessId,
          instance.templateId,
          instance.instanceKey,
          blob
        );
      }

      const result = await completeInstance({
        templateId: instance.templateId,
        instanceKey: instance.instanceKey,
        checklistState: instance.checklist.map((c, idx) => ({
          label: c.label,
          checked: checked[idx] === true,
        })),
        photoPath,
      });
      onDone(result.message, result.ok);
      if (result.ok) onClose();
      else setError(result.message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Completion failed.';
      setError(msg);
      onDone(msg, false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Complete: ${instance.title}`} onClose={onClose}>
      {instance.status === 'delinquent' && (
        <p style={{ color: 'var(--red)', marginTop: 0 }}>
          This task is delinquent (red-flagged) — completing it now still
          counts, and the completion is recorded.
        </p>
      )}

      {instance.checklist.length > 0 ? (
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
          <legend className="label" style={{ marginBottom: 8 }}>
            Checklist — all required
          </legend>
          {instance.checklist.map((item, idx) => (
            <label
              key={idx}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '8px 0',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={checked[idx] === true}
                onChange={() => toggle(idx)}
                style={{ marginTop: 3, width: 18, height: 18 }}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p style={{ color: 'var(--text2)' }}>
          No checklist on this task — confirm completion below.
        </p>
      )}

      {needsPhoto && (
        <div style={{ margin: '0 0 16px' }}>
          <label className="label" htmlFor="task-photo">
            Completion photo (required)
          </label>
          <TextInput
            id="task-photo"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setFileName(f?.name ?? null);
            }}
          />
          {fileName && (
            <p style={{ color: 'var(--text2)', fontSize: 13, margin: '6px 0 0' }}>
              Selected: {fileName} (resized to max 480px on upload)
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="status" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={submit}
          disabled={
            submitting ||
            (instance.checklist.length > 0 && !allChecked) ||
            (needsPhoto && !fileName)
          }
        >
          {submitting ? 'Completing…' : 'Mark complete'}
        </Button>
      </div>
    </Modal>
  );
}
