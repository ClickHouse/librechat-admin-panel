import { join } from 'node:path';
import { Glob } from 'bun';

const CLIENT_DIR = join(import.meta.dir, 'dist', 'client');
const SERVER_ENTRY = new URL('./dist/server/server.js', import.meta.url);

type Handler = { default: { fetch: (req: Request) => Promise<Response> } };

const { default: handler } = (await import(SERVER_ENTRY.href)) as Handler;

async function buildStaticRoutes(): Promise<Record<string, () => Response>> {
  const routes: Record<string, () => Response> = {};
  for await (const path of new Glob('**/*').scan(CLIENT_DIR)) {
    const file = Bun.file(`${CLIENT_DIR}/${path}`);
    routes[`/${path}`] = () => new Response(file, { headers: { 'Content-Type': file.type } });
  }
  return routes;
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    ...(await buildStaticRoutes()),
    '/*': (req) => handler.fetch(req),
  },
});

console.log(`Admin panel listening on http://localhost:${process.env.PORT ?? 3000}`);
