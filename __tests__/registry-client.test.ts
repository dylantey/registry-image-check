import { describe, it, expect, vi } from 'vitest';
import * as https from 'https';
import { checkManifest } from '../src/registry-client';

vi.mock('https');

describe('checkManifest', () => {
  it('returns exists=true and digest on HTTP 200', async () => {
    const mockReq = {
      on: vi.fn(),
      end: vi.fn(),
    };

    const mockRes = {
      statusCode: 200,
      headers: {
        'docker-content-digest': 'sha256:abcdef',
      },
    };

    vi.mocked(https.request).mockImplementation((_options, callback) => {
      callback(mockRes as any);
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

    const mockRes = {
      statusCode: 404,
      headers: {},
    };

    vi.mocked(https.request).mockImplementation((_options, callback) => {
      callback(mockRes as any);
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

    const mockRes = {
      statusCode: 200,
      headers: {},
    };

    let capturedOptions: any;
    vi.mocked(https.request).mockImplementation((options: any, callback) => {
      capturedOptions = options;
      callback(mockRes as any);
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

    const mockRes = {
      statusCode: 200,
      headers: {},
    };

    let capturedOptions: any;
    vi.mocked(https.request).mockImplementation((options: any, callback) => {
      capturedOptions = options;
      callback(mockRes as any);
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
});
