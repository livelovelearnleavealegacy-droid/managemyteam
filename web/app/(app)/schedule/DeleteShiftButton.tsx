'use client';

import { Button } from '@/components/ui';

export default function DeleteShiftButton({
  id,
  week,
  onDelete,
}: {
  id: string;
  week: number;
  onDelete: (formData: FormData) => void;
}) {
  return (
    <form
      action={onDelete}
      onSubmit={(e) => {
        if (!window.confirm('Delete this shift?')) e.preventDefault();
      }}
      style={{ margin: 0 }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="week" value={String(week)} />
      <Button
        type="submit"
        variant="danger"
        aria-label="Delete shift"
        style={{ padding: '2px 10px', fontSize: 12 }}
      >
        Delete
      </Button>
    </form>
  );
}
