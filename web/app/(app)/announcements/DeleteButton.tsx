'use client';

import { Button } from '@/components/ui';

/**
 * Delete button with a native confirm dialog. The server action is passed in
 * already bound to the record id.
 */
export default function DeleteButton({
  action,
  label,
  itemName,
}: {
  action: (formData: FormData) => void;
  label: string;
  itemName: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('Delete this ' + itemName + '? This cannot be undone.')) {
          e.preventDefault();
        }
      }}
    >
      <Button variant="danger" type="submit" aria-label={'Delete ' + itemName}>
        {label}
      </Button>
    </form>
  );
}
