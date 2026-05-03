import { createServer } from 'node:http';

const parsedPort = parseInt(process.env.MOCK_BACKEND_PORT || '3081', 10);
const PORT = Number.isNaN(parsedPort) ? 3081 : parsedPort;

function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('error', () => resolve({}));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
  });
}

const VALID_TEMP_TOKEN = 'valid-2fa-temp-token-for-testing';

const handlers = {
  'POST /api/admin/login/local': (body) => {
    if (body.email === 'rejected@test.com')
      return [422, { message: 'Invalid credentials' }];
    if (body.email === '2fa@test.com')
      return [200, { twoFAPending: true, tempToken: VALID_TEMP_TOKEN }];
    return [
      200,
      {
        token: 'test-admin-token',
        user: {
          id: 'u_test',
          email: body.email,
          name: 'Test Admin',
          role: 'ADMIN',
        },
      },
    ];
  },
  'POST /api/auth/2fa/verify-temp': (body) => {
    if (body.tempToken !== VALID_TEMP_TOKEN)
      return [401, { message: 'Invalid or expired temporary token' }];
    if (body.token === '000000')
      return [401, { message: 'Invalid 2FA code or backup code' }];
    return [
      200,
      {
        token: 'test-admin-token-2fa',
        user: {
          id: 'u_2fa',
          email: '2fa@test.com',
          name: '2FA Admin',
          role: 'ADMIN',
        },
      },
    ];
  },
  'GET /api/admin/verify': (_body, req) => {
    const auth = req?.headers?.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return [401, { error: 'Authentication required' }];
    const token = auth.slice('Bearer '.length);
    if (token !== 'test-admin-token' && token !== 'test-admin-token-2fa')
      return [401, { error: 'Invalid or expired token' }];
    return [
      200,
      {
        user: {
          id: 'u_test',
          email: 'admin@test.com',
          name: 'Test Admin',
          role: 'ADMIN',
        },
      },
    ];
  },
  'GET /api/admin/oauth/openid/check': () => [
    200,
    { message: 'OpenID check successful' },
  ],
  /**
   * Mirrors LibreChat's public /api/config payload — the same endpoint the
   * admin panel uses to discover which OAuth providers are enabled. Only the
   * auth-relevant flags are enumerated. Both openid and google are enabled by
   * default so the e2e suite can exercise the multi-provider UI path.
   */
  'GET /api/config': () => [
    200,
    {
      appTitle: 'LibreChat',
      openidLoginEnabled: true,
      googleLoginEnabled: true,
      githubLoginEnabled: false,
      discordLoginEnabled: false,
      facebookLoginEnabled: false,
      appleLoginEnabled: false,
      samlLoginEnabled: false,
      socialLoginEnabled: true,
      openidLabel: 'Continue with OpenID',
      openidAutoRedirect: false,
      emailLoginEnabled: true,
    },
  ],
};

const server = createServer(async (req, res) => {
  const path = req.url?.split('?')[0];
  const key = `${req.method} ${path}`;
  const handler = handlers[key];

  let status = 404;
  let body = { error: 'not found' };

  if (handler) {
    const reqBody = req.method === 'POST' ? await parseBody(req) : {};
    [status, body] = handler(reqBody, req);
  }

  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
});

server.listen(PORT, () => {
  console.log(`Mock backend listening on http://localhost:${PORT}`);
});
