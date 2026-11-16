import { describe, it, expect, vi } from 'vitest';
import * as https from 'https';
import { checkManifest } from '../src/registry-client';

vi.mock('https');

function createMockRes(statusCode: number, headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers,
    resume: vi.fn(),
    on: vi.fn(),
  };
}

describe('checkManifest', () => {
  it('returns exists=true and digest on HTTP 200', async () => {
    const mockReq = {
      on: vi.fn(),
      end: vi.fn(),
    };

    vi.mocked(https.request).mockImplementation((_options, callback) => {
      callback(createMockRes(200, { 'docker-content-digest': 'sha256:abcdef' }) as any);
      return mockReq as any;
    });

    const result = await checkManifest('registry.io', 'repo/image', 'latest');
    expect(result.exists).toBe(true);
    expect(result.digest).toBe('sha256:abcdef');
  });

  it('returns exists=false on HTTP 404', async () => {
    const mockReq = {
      on: vi.fn(),
      end: vi.fn(),
    };

    vi.mocked(https.request).mockImplementation((_options, callback) => {
      callback(createMockRes(404) as any);
      return mockReq as any;
    });

    const result = await checkManifest('registry.io', 'repo/image', 'latest');
    expect(result.exists).toBe(false);
  });

  it('does not send Authorization header when auth is omitted', async () => {
    const mockReq = {
      on: vi.fn(),
      end: vi.fn(),
    };

    let capturedOptions: any;
    vi.mocked(https.request).mockImplementation((options: any, callback) => {
      capturedOptions = options;
      callback(createMockRes(200) as any);
      return mockReq as any;
    });

    await checkManifest('registry.io', 'repo/image', 'latest');
    expect(capturedOptions.headers.Authorization).toBeUndefined();
  });

  it('sends Authorization header when auth is provided', async () => {
    const mockReq = {
      on: vi.fn(),
      end: vi.fn(),
    };

    let capturedOptions: any;
    vi.mocked(https.request).mockImplementation((options: any, callback) => {
      capturedOptions = options;
      callback(createMockRes(200) as any);
      return mockReq as any;
    });

    await checkManifest('registry.io', 'repo/image', 'latest', {
      username: 'user',
      password: 'pass',
    });
    expect(capturedOptions.headers.Authorization).toBe(
      `Basic ${Buffer.from('user:pass').toString('base64')}`
    );
  });

  it('fetches bearer token on 401 and retries', async () => {
    const mockReq = {
      on: vi.fn(),
      end: vi.fn(),
    };

    const calls: Array<{ options: any; response: any }> = [];
    vi.mocked(https.request).mockImplementation((options: any, callback) => {
      const isTokenRequest = options.path.includes('/token');
      if (isTokenRequest) {
        const tokenRes = {
          statusCode: 200,
          headers: {},
          on: vi.fn((event: string, handler: (chunk: string) => void) => {
            if (event === 'data') {
              handler(JSON.stringify({ token: 'my-bearer-token' }));
            }
            if (event === 'end') {
              handler();
            }
          }),
          resume: vi.fn(),
        };
        calls.push({ options, response: tokenRes });
        callback(tokenRes as any);
      } else if (calls.length === 0) {
        const challengeRes = createMockRes(401, {
          'www-authenticate': 'Bearer realm="https://registry.io/token",service="registry.io",scope="repository:repo/image:pull"',
        });
        calls.push({ options, response: challengeRes });
        callback(challengeRes as any);
      } else {
        const successRes = createMockRes(200, { 'docker-content-digest': 'sha256:123456' });
        calls.push({ options, response: successRes });
        callback(successRes as any);
      }
      return mockReq as any;
    });

    const result = await checkManifest('registry.io', 'repo/image', 'latest');
    expect(result.exists).toBe(true);
    expect(result.digest).toBe('sha256:123456');
    expect(calls.length).toBe(3);
    expect(calls[2].options.headers.Authorization).toBe('Bearer my-bearer-token');
  });
});
