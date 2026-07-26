import { Storage } from '@google-cloud/storage';

// Shared GCS PNG upload. Returns the public URL, or null when GCS is not
// configured or the upload cannot be made publicly readable.
export async function uploadPngToGCS(buffer, destination) {
  if (!process.env.GCS_BUCKET_NAME) return null;

  const gcsUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${destination}`;
  const storage = new Storage();
  const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
  const file = bucket.file(destination);

  await file.save(buffer, {
    contentType: 'image/png',
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  try {
    await file.makePublic();
  } catch {
    // Uniform bucket-level access blocks makePublic; the object may still be
    // readable if the bucket itself is public — verify before trusting the URL.
    const verify = await fetch(gcsUrl, { method: 'HEAD' });
    if (!verify.ok) {
      console.warn('[GCS] Object not publicly accessible:', gcsUrl);
      return null;
    }
  }

  return gcsUrl;
}
