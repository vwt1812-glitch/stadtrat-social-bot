// Optionaler Helfer für gitroomhq/postiz-app. Kein Laufzeitimport des Bots.
// Der Provider übergibt seinen SSRF-sicheren Dispatcher. Niemals durch normalen fetch ersetzen.
import { Readable } from 'node:stream';

export async function loadMastodonThumbnail(
  url: string | undefined,
  dispatcher: unknown,
  fetcher: typeof fetch = fetch
): Promise<Buffer | undefined> {
  if (!url) return undefined;
  const res = await fetcher(url, {
    headers: { 'accept-encoding': 'identity' },
    signal: AbortSignal.timeout(30000),
    // @ts-ignore - Dispatcher ist eine Node/undici-Erweiterung.
    dispatcher,
  });
  if (!res.ok || !res.body) throw new Error('Could not download Mastodon thumbnail');
  const typ = res.headers.get('content-type')?.split(';')[0].trim();
  if (typ !== 'image/jpeg') {
    await res.body.cancel();
    throw new Error('Mastodon thumbnail must be JPEG');
  }
  const max = 2 * 1024 * 1024;
  if (Number(res.headers.get('content-length')) > max) {
    await res.body.cancel();
    throw new Error('Mastodon thumbnail exceeds 2 MiB');
  }
  let bytes = 0;
  const teile: Buffer[] = [];
  for await (const chunk of Readable.fromWeb(res.body as any)) {
    bytes += chunk.length;
    if (bytes > max) throw new Error('Mastodon thumbnail exceeds 2 MiB');
    teile.push(Buffer.from(chunk));
  }
  const bild = Buffer.concat(teile);
  if (bild.length < 3 || bild[0] !== 0xff || bild[1] !== 0xd8 || bild[2] !== 0xff) throw new Error('Invalid JPEG thumbnail');
  return bild;
}
