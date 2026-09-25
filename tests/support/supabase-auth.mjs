import { generateKeyPairSync, sign } from 'node:crypto';

// A local ES256 signing key stands in for the Supabase project's JWKS.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const kid = 'test-signing-key';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };

export const supabaseEnv = {
  SUPABASE_URL: 'https://nexui-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
};

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function signToken(claims = {}, { expiresIn = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'ES256', typ: 'JWT', kid });
  const payload = encode({
    iss: `${supabaseEnv.SUPABASE_URL}/auth/v1`,
    aud: 'authenticated',
    role: 'authenticated',
    sub: '6f1c9a52-0d0e-4b8f-9f4a-2f0d6f2c9a11',
    email: 'tester@example.com',
    is_anonymous: false,
    iat: now,
    exp: now + expiresIn,
    ...claims,
  });
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Sets the Supabase env vars and mocks fetch: the JWKS endpoint serves the test key and
 * every other request goes to `upstream`. Returns the upstream mock for call counting.
 */
export function mockSupabaseAuth(t, upstream = async () => new Response(null, { status: 404 })) {
  for (const [key, value] of Object.entries(supabaseEnv)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const upstreamMock = t.mock.fn(upstream);
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/auth/v1/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    return upstreamMock(input, init);
  });
  return upstreamMock;
}

/** Reads one call the upstream mock received, for asserting PostgREST requests. */
export function upstreamCall(upstream, index = 0) {
  const [input, init] = upstream.mock.calls[index].arguments;
  const request = input instanceof Request ? input : null;
  const body = init?.body;
  return {
    url: new URL(request?.url ?? String(input)),
    method: init?.method ?? request?.method ?? 'GET',
    headers: new Headers(request?.headers ?? init?.headers),
    body: typeof body === 'string' ? JSON.parse(body) : null,
  };
}
