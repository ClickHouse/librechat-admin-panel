import { Glob } from 'bun';
import { join } from 'node:path';
import {
  metricsResponse,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  normalizeMetricsPath,
} from './src/server/metrics';

const CLIENT_DIR = join(import.meta.dir, 'dist', 'client');
const SERVER_ENTRY = new URL('./dist/server/server.js', import.meta.url);

const env = process.env;

const ONE_DAY = 86400;
const rawMaxAge = Number(env.ADMIN_PANEL_STATIC_CACHE_MAX_AGE ?? env.STATIC_CACHE_MAX_AGE);
const rawSMaxAge = Number(env.ADMIN_PANEL_STATIC_CACHE_S_MAX_AGE ?? env.STATIC_CACHE_S_MAX_AGE);
const maxAge = Number.isNaN(rawMaxAge) ? ONE_DAY * 2 : rawMaxAge;
const sMaxAge = Number.isNaN(rawSMaxAge) ? ONE_DAY : rawSMaxAge;

const NO_CACHE: Record<string, string> = {
  'Cache-Control':
    env.ADMIN_PANEL_INDEX_CACHE_CONTROL ??
    env.INDEX_CACHE_CONTROL ??
    'no-cache, no-store, must-revalidate',
  Pragma: env.ADMIN_PANEL_INDEX_PRAGMA ?? env.INDEX_PRAGMA ?? 'no-cache',
  Expires: env.ADMIN_PANEL_INDEX_EXPIRES ?? env.INDEX_EXPIRES ?? '0',
};

const LONG_CACHE: Record<string, string> = {
  'Cache-Control': `public, max-age=${maxAge}, s-maxage=${sMaxAge}`,
};

const NEVER_CACHE = new Set(['manifest.json', 'sw.js', 'robots.txt']);

function getCacheHeaders(filePath: string): Record<string, string> {
  const fileName = filePath.split('/').pop() ?? '';
  if (NEVER_CACHE.has(fileName)) return NO_CACHE;
  if (filePath.startsWith('assets/')) return LONG_CACHE;
  return {};
}

type Handler = { default: { fetch: (req: Request) => Promise<Response> } };

const { default: handler } = (await import(SERVER_ENTRY.href)) as Handler;

async function withHttpMetrics(
  req: Request,
  pathname: string,
  getResponse: () => Response | Promise<Response>,
): Promise<Response> {
  const path = normalizeMetricsPath(pathname);
  const end = httpRequestDurationSeconds.startTimer({ method: req.method, path });
  const res = await getResponse();
  const statusCode = String(res.status);
  httpRequestsTotal.inc({ method: req.method, path, status_code: statusCode });
  end({ status_code: statusCode });
  return res;
}

async function buildStaticRoutes(): Promise<Record<string, (req: Request) => Promise<Response>>> {
  const routes: Record<string, (req: Request) => Promise<Response>> = {};
  for await (const path of new Glob('**/*').scan(CLIENT_DIR)) {
    const file = Bun.file(`${CLIENT_DIR}/${path}`);
    const cache = getCacheHeaders(path);
    const routePath = `/${path}`;
    routes[routePath] = (req) =>
      withHttpMetrics(
        req,
        routePath,
        () => new Response(file, { headers: { 'Content-Type': file.type, ...cache } }),
      );
  }
  return routes;
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    ...(await buildStaticRoutes()),
    '/metrics': (req) => metricsResponse(req),
    '/*': async (req) => {
      const url = new URL(req.url);
      const res = await withHttpMetrics(req, url.pathname, () => handler.fetch(req));
      const patched = new Response(res.body, res);
      for (const [k, v] of Object.entries(NO_CACHE)) {
        patched.headers.set(k, v);
      }
      return patched;
    },
  },
});

console.log(`Admin panel listening on http://localhost:${server.port}`);

if (!process.env.ADMIN_PANEL_METRICS_SECRET) {
  console.warn(
    '[metrics] ADMIN_PANEL_METRICS_SECRET is not set — /metrics will return 401 for all requests',
  );
}
