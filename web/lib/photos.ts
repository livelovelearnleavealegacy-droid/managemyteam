'use client';

/**
 * managemyteam.io — task completion photos (Railway-native).
 *
 * Photo policy (deliberate choice):
 *   - Photos are stored as plain files on a Railway volume under
 *     PHOTOS_DIR (default /data/photos) at
 *     `{businessId}/{templateId}/{instanceKey}.jpg`. The relative STORAGE
 *     PATH (not a URL) is what lives in task_completions.photo_url.
 *   - At display time, `getTaskPhotoUrl(path)` returns `/api/photos/${path}`,
 *     an app route that authenticates the session cookie on every request
 *     and only serves photos whose first path segment is the caller's own
 *     business_id. No signed URLs, no long-lived photo URLs in the database.
 *   - Uploads are immutable in v0.1: POST /api/photos returns 409 when the
 *     file already exists; completion of the same instance is blocked
 *     server-side, so no overwrite is needed.
 */

const MAX_WIDTH = 480;
const JPEG_QUALITY = 0.6;

/** Downscale to max 480px wide and encode as JPEG 0.6. */
export function resizeImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Selected file is not an image.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not process the image.'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Could not encode the image.'));
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the selected image.'));
    };
    img.src = url;
  });
}

function photoPath(businessId: string, templateId: string, key: string): string {
  return `${businessId}/${templateId}/${key}.jpg`;
}

/**
 * Upload the resized photo to /api/photos. Returns the STORAGE PATH (stored
 * in task_completions.photo_url), not a URL.
 *
 * (Supabase storage removed; the first `supabase` argument from the original
 * signature was dropped since the session cookie carries auth now.)
 */
export async function uploadTaskPhoto(
  businessId: string,
  templateId: string,
  instanceKey: string,
  blob: Blob
): Promise<string> {
  const form = new FormData();
  form.append('file', blob, 'photo.jpg');
  form.append('templateId', templateId);
  form.append('instanceKey', instanceKey);

  const res = await fetch('/api/photos', { method: 'POST', body: form });
  if (res.status === 409) {
    throw new Error('This photo has already been uploaded.');
  }
  if (!res.ok) {
    const message = await res.text().catch(() => '');
    throw new Error(`Photo upload failed: ${message || res.statusText}`);
  }
  const data = (await res.json()) as { path?: string };
  if (!data.path) throw new Error('Photo upload failed: no path returned.');
  // Server derives the path from the session's business_id; trust but verify.
  const expected = photoPath(businessId, templateId, instanceKey);
  if (data.path !== expected) {
    throw new Error(`Photo upload failed: unexpected path ${data.path}.`);
  }
  return data.path;
}

/**
 * Return the app route URL for a stored photo path (display time).
 * Auth is checked cookie-side by the route on every request.
 */
export function getTaskPhotoUrl(path: string): string {
  return `/api/photos/${path}`;
}

/** Alias kept for convenience. */
export const getPhotoUrl = getTaskPhotoUrl;
