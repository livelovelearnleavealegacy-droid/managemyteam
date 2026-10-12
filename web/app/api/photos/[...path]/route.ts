import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getSessionUser } from '@/lib/auth';

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

function photosDir(): string {
  return process.env.PHOTOS_DIR ?? '/data/photos';
}

function validSegment(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && SEGMENT_RE.test(s);
}

/**
 * GET /api/photos/{businessId}/{templateId}/{instanceKey}.jpg
 *
 * Serves a stored task photo. The first path segment must equal the
 * session's business_id, otherwise 404 (never leak cross-tenant existence).
 * Cached privately for one hour.
 */
export async function GET(
  _req: Request,
  { params }: { params: { path: string[] } }
): Promise<Response> {
  const session = await getSessionUser();
  const segments = params.path ?? [];

  if (
    !session ||
    segments.length === 0 ||
    !segments.every(validSegment) ||
    segments[0] !== session.profile.business_id
  ) {
    return new Response('Not found.', { status: 404 });
  }

  try {
    const data = await readFile(join(photosDir(), ...segments));
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(data.length),
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return new Response('Not found.', { status: 404 });
    }
    throw err;
  }
}
