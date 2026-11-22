import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as https from 'https';
import { checkManifest, resolveApiHost } from '../src/registry-client';

vi.mock('https');

type Step =
  | { status: number; headers?: Record<string, string>; body?: string }
  | { error: Error };

/**
 * Each https.request call consumes the next step. Errors are emitted on the request,
 * responses are delivered through the request callback. The last step repeats if
 * more calls happen than steps provided.
 */
function mockSequence(steps: Step[]): any[] {
  const calls: any[] = [];
  let index = 0;

  vi.mocked(https.request).mockImplementation((options: any, callback: any) => {
    calls.push(options);
    const step = steps[Math.min(index++, steps.length - 1)];

    const req = {
      setTimeout: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(),
      on: vi.fn((event: string, handler: (err: Error) => void) => {
        if (event === 'error' && 'error' in step) handler(step.error);
      }),
    };

    if (!('error' in step)) {
      callback({
        statusCode: step.status,
        headers: step.headers ?? {},
        resume: vi.fn(),
        on: vi.fn((event: string, handler: (chunk?: string) => void) => {
          if (event === 'data' && step.body) handler(step.body);
          if (event === 'end') handler();
        }),
      } as any);
    }

    return req as any;
  });

  return calls;
}

const CHALLENGE = {
  'www-authenticate':
    'Bearer realm="https://registry.io/token",service="registry.io",scope="repository:repo/image:pull"',
};

describe('resolveApiHost', () => {
  it('maps docker.io to the Docker Hub API host', () => {
    expect(resolveApiHost('docker.io')).toBe('registry-1.docker.io');
  });

  it('leaves other registries unchanged', () => {
    expect(resolveApiHost('registry.io')).toBe('registry.io');
  });
});

describe('checkManifest', () => {
  let sleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    sleep = vi.fn(async () => {});
  });

  it('sends docker.io requests to registry-1.docker.io', async () => {
    const calls = mockSequence([{ status: 200, headers: { 'docker-content-digest': 'sha256:1' } }]);

    const result = await checkManifest('docker.io', 'library/ubuntu', '22.04', undefined, { sleep });

    expect(result.exists).toBe(true);
    expect(calls[0].hostname).toBe('registry-1.docker.io');
    expect(calls[0].path).toBe('/v2/library/ubuntu/manifests/22.04');
  });

  it('returns exists=true and digest on HTTP 200', async () => {
    mockSequence([{ status: 200, headers: { 'docker-content-digest': 'sha256:abcdef' } }]);

    const result = await checkManifest('registry.io', 'repo/image', 'latest', undefined, { sleep });
    expect(result.exists).toBe(true);
    expect(result.digest).toBe('sha256:abcdef');
  });

  it('returns exists=false on HTTP 404 without retrying', async () => {
    const calls = mockSequence([{ status: 404 }]);

    const result = await checkManifest('registry.io', 'repo/image', 'latest', undefined, { sleep });
    expect(result.exists).toBe(false);
    expect(calls.length).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not send Authorization header when auth is omitted', async () => {
    const calls = mockSequence([{ status: 200 }]);

    await checkManifest('registry.io', 'repo/image', 'latest', undefined, { sleep });
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('sends Authorization header when auth is provided', async () => {
    const calls = mockSequence([{ status: 200 }]);

    await checkManifest(
      'registry.io',
      'repo/image',
      'latest',
      { username: 'user', password: 'pass' },
      { sleep }
    );
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from('user:pass').toString('base64')}`
    );
  });

  it('fetches bearer token on 401 and retries', async () => {
    const calls = mockSequence([
      { status: 401, headers: CHALLENGE },
      { status: 200, body: JSON.stringify({ token: 'my-bearer-token' }) },
      { status: 200, headers: { 'docker-content-digest': 'sha256:123456' } },
    ]);

    const result = await checkManifest('registry.io', 'repo/image', 'latest', undefined, { sleep });
    expect(result.exists).toBe(true);
    expect(result.digest).toBe('sha256:123456');
    expect(calls.length).toBe(3);
    expect(calls[2].headers.Authorization).toBe('Bearer my-bearer-token');
  });

  it('retries once on 503 and then succeeds', async () => {
    const calls = mockSequence([{ status: 503 }, { status: 200 }]);

    const result = await checkManifest('registry.io', 'repo/image', 'latest', undefined, { sleep });
    expect(result.exists).toBe(true);
    expect(calls.length).toBe(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('retries network errors and then succeeds', async () => {
    const calls = mockSequence([{ error: new Error('socket hang up') }, { status: 200 }]);

    const result = await checkManifest('registry.io', 'repo/image', 'latest', undefined, { sleep });
    expect(result.exists).toBe(true);
    expect(calls.length).toBe(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('gives up after 3 attempts on repeated timeouts', async () => {
    const calls = mockSequence([{ error: new Error('Request to registry.io timed out after 10000ms') }]);

    await expect(
      checkManifest('registry.io', 'repo/image', 'latest', undefined, { sleep })
    ).rejects.toThrow('timed out');
    expect(calls.length).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('reports 5xx as unexpected status after exhausting retries', async () => {
    const calls = mockSequence([{ status: 500 }]);

    await expect(
      checkManifest('registry.io', 'repo/image', 'latest', undefined, { sleep })
    ).rejects.toThrow('Unexpected status 500');
    expect(calls.length).toBe(3);
  });

  it('does not retry 403', async () => {
    const calls = mockSequence([{ status: 403 }]);

    await expect(
      checkManifest('registry.io', 'repo/image', 'latest', undefined, { sleep })
    ).rejects.toThrow('Forbidden (403)');
    expect(calls.length).toBe(1);
  });

  it('honors Retry-After on 429 and then succeeds', async () => {
    const calls = mockSequence([{ status: 429, headers: { 'retry-after': '2' } }, { status: 200 }]);

    const result = await checkManifest('docker.io', 'library/ubuntu', '22.04', undefined, { sleep });
    expect(result.exists).toBe(true);
    expect(calls.length).toBe(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('caps Retry-After at 30 seconds', async () => {
    mockSequence([{ status: 429, headers: { 'retry-after': '600' } }, { status: 200 }]);

    await checkManifest('registry.io', 'repo/image', 'latest', undefined, { sleep });
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it('throws a specific rate-limit error after repeated 429s, never exists=false', async () => {
    const calls = mockSequence([{ status: 429 }]);

    await expect(
      checkManifest('docker.io', 'library/ubuntu', '22.04', undefined, { sleep })
    ).rejects.toThrow(/Rate limited \(429\) by docker\.io.*docker login/);
    expect(calls.length).toBe(3);
  });
});
