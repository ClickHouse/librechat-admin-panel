import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * AWS Lambda entry point for running the admin panel serverlessly behind a
 * Lambda Function URL or an API Gateway HTTP API (payload format 2.0).
 *
 * The same Lambda also serves the static client assets (`dist/client`, bundled
 * next to the handler as `client/`), so no CDN or S3 bucket is required — the
 * deployed zip is self-contained. Build it with `bun run build:lambda`.
 */

type LambdaEvent = {
  rawPath: string;
  rawQueryString: string;
  cookies?: string[];
  headers?: Record<string, string>;
  requestContext: { http: { method: string } };
  body?: string;
  isBase64Encoded?: boolean;
};

type LambdaResult = {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
  isBase64Encoded: boolean;
};

type FetchHandler = { default: { fetch: (request: Request) => Promise<Response> } };

const { default: app } = (await import('./dist/server/server.js')) as FetchHandler;

const CLIENT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'client');
const NO_CACHE = 'no-cache, no-store, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NEVER_CACHE = new Set(['/manifest.json', '/robots.txt', '/sw.js']);

const CONTENT_TYPES: Record<string, string> = {
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain',
  map: 'application/json',
};

function contentType(pathname: string): string {
  const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function isStaticPath(pathname: string): boolean {
  return (
    pathname.startsWith('/assets/') ||
    pathname.endsWith('.svg') ||
    pathname === '/favicon.ico' ||
    NEVER_CACHE.has(pathname)
  );
}

function acceptsGzip(event: LambdaEvent): boolean {
  return (event.headers?.['accept-encoding'] ?? '').includes('gzip');
}

function isCompressible(contentType: string): boolean {
  return /javascript|css|json|html|svg|text|xml|manifest/.test(contentType);
}

// Lambda response payloads are capped at 6 MB. Gzipping compressible assets
// keeps large chunks (e.g. the icons bundle) well under it and cuts transfer.
function encodeBody(
  buffer: Buffer,
  contentType: string,
  gzip: boolean,
): { body: string; contentEncoding?: string } {
  if (gzip && isCompressible(contentType) && buffer.length > 1024) {
    return { body: gzipSync(buffer).toString('base64'), contentEncoding: 'gzip' };
  }
  return { body: buffer.toString('base64') };
}

function buildRequest(event: LambdaEvent): Request {
  const headers = new Headers();
  if (event.headers) {
    for (const [name, value] of Object.entries(event.headers)) headers.set(name, value);
  }
  if (event.cookies?.length) headers.set('cookie', event.cookies.join('; '));

  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost';
  const proto = headers.get('x-forwarded-proto') ?? 'https';
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const url = `${proto}://${host}${event.rawPath}${query}`;

  const method = event.requestContext.http.method;
  const hasBody = event.body != null && method !== 'GET' && method !== 'HEAD';
  const body = hasBody
    ? event.isBase64Encoded
      ? Buffer.from(event.body as string, 'base64')
      : event.body
    : undefined;

  return new Request(url, { method, headers, body });
}

async function serveStatic(pathname: string, gzip: boolean): Promise<LambdaResult | null> {
  const filePath = join(CLIENT_DIR, pathname);
  if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR + sep)) return null;
  try {
    const data = await readFile(filePath);
    const ct = contentType(pathname);
    const cache = pathname.startsWith('/assets/') ? IMMUTABLE : NEVER_CACHE.has(pathname) ? NO_CACHE : '';
    const encoded = encodeBody(data, ct, gzip);
    const headers: Record<string, string> = { 'content-type': ct };
    if (cache) headers['cache-control'] = cache;
    if (encoded.contentEncoding) {
      headers['content-encoding'] = encoded.contentEncoding;
      headers['vary'] = 'accept-encoding';
    }
    return { statusCode: 200, headers, body: encoded.body, isBase64Encoded: true };
  } catch {
    return null;
  }
}

async function toLambdaResult(response: Response, gzip: boolean): Promise<LambdaResult> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') return;
    headers[key] = value;
  });
  if (!headers['cache-control']) headers['cache-control'] = NO_CACHE;

  const cookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];

  const buffer = Buffer.from(await response.arrayBuffer());
  const ct = headers['content-type'] ?? '';
  const alreadyEncoded = 'content-encoding' in headers;
  const encoded = encodeBody(buffer, ct, gzip && !alreadyEncoded);
  if (encoded.contentEncoding) {
    headers['content-encoding'] = encoded.contentEncoding;
    headers['vary'] = headers['vary'] ? `${headers['vary']}, accept-encoding` : 'accept-encoding';
    delete headers['content-length'];
  }

  return {
    statusCode: response.status,
    headers,
    cookies: cookies.length ? cookies : undefined,
    body: encoded.body,
    isBase64Encoded: true,
  };
}

export async function handler(event: LambdaEvent): Promise<LambdaResult> {
  if (event.rawPath === '/health') {
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'ok',
      isBase64Encoded: false,
    };
  }

  const gzip = acceptsGzip(event);

  if (isStaticPath(event.rawPath)) {
    const asset = await serveStatic(event.rawPath, gzip);
    if (asset) return asset;
  }

  const response = await app.fetch(buildRequest(event));
  return toLambdaResult(response, gzip);
}
