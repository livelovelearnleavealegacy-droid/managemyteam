import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getSessionUser } from '@/lib/auth';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

function photosDir(): string {
  return process.env.PHOTOS_DIR ?? '/data/photos';
}

function validSegment(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && SEGMENT_RE.test(s);
}

/**
 * POST /api/photos
 *
 * Multipart form-data fields:
 *   - file: Blob (image, <= 5MB)
 *   - templateId: string
 *   - instanceKey: string
 *
 * Stores the photo at {businessId}/{templateId}/{instanceKey}.jpg under
 * PHOTOS_DIR. Uploads are IMMUTABLE in v0.1: an existing file returns 409.
 * Responds { path: "{businessId}/{templateId}/{instanceKey}.jpg" }.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getSessionUser();
  if (!session) {
    return new Response('Not signed in.', { status: 401 });
  }
  const businessId = session.profile.business_id;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response('Expected multipart form-data.', { status: 400 });
  }

  const file = form.get('file');
  const templateId = form.get('templateId');
  const instanceKey = form.get('instanceKey');

  if (!(file instanceof Blob) || file.size === 0) {
    return new Response('Missing file.', { status: 400 });
  }
  if (!file.type.startsWith('image/')) {
    return new Response('File is not an image.', { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return new Response('File exceeds the 5MB limit.', { status: 400 });
  }
  if (!validSegment(businessId) || !validSegment(templateId) || !validSegment(instanceKey)) {
    return new Response('Invalid path segment.', { status: 400 });
  }

  const dir = join(photosDir(), businessId, templateId);
  const filename = `${instanceKey}.jpg`;
  await mkdir(dir, { recursive: true });

  const buf = Buffer.from(await file.arrayBuffer());
  try {
    // 'wx' fails atomically if the file already exists -> immutability.
    await writeFile(join(dir, filename), buf, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') {
      return new Response('Photo already exists and cannot be overwritten.', {
        status: 409,
      });
    }
    throw err;
  }

  const path = `${businessId}/${templateId}/${filename}`;
  return Response.json({ path });
}
