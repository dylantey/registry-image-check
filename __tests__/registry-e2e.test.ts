import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { checkManifest } from '../src/registry-client';

// Exercises the real HTTP stack against a local fake registry.
// Retry backoff is stubbed to keep the suite fast; timeouts are real but short.

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, requestNumber: number) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler;
let requestCount: number;
let lastMethod: string | undefined;
let lastAuthorization: string | undefined;

const fastOptions = {
  sleep: async () => {},
  timeoutMs: 200,
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requestCount++;
    lastMethod = req.method;
    lastAuthorization = req.headers.authorization;
    handler(req, res, requestCount);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requestCount = 0;
  lastMethod = undefined;
  lastAuthorization = undefined;
  handler = (_req, res) => {
    res.writeHead(404);
    res.end();
  };
});

describe('checkManifest against a local registry', () => {
  it('returns exists=true and digest on 200, using a HEAD request', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'docker-content-digest': 'sha256:e2e' });
      res.end();
    };

    const result = await checkManifest(baseUrl, 'repo/image', 'latest', undefined, fastOptions);

    expect(result).toEqual({ exists: true, digest: 'sha256:e2e' });
    expect(lastMethod).toBe('HEAD');
  });

  it('returns exists=false on 404', async () => {
    const result = await checkManifest(baseUrl, 'repo/image', 'missing', undefined, fastOptions);
    expect(result.exists).toBe(false);
    expect(requestCount).toBe(1);
  });

  it('completes the bearer token flow against the same server', async () => {
    handler = (req, res) => {
      if (req.url?.startsWith('/token')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'e2e-token' }));
        return;
      }
      if (!req.headers.authorization) {
        res.writeHead(401, {
          'WWW-Authenticate': `Bearer realm="${baseUrl}/token",service="fake-registry"`,
        });
        res.end();
        return;
      }
      res.writeHead(200, { 'docker-content-digest': 'sha256:bearer' });
      res.end();
    };

    const result = await checkManifest(baseUrl, 'repo/image', 'latest', undefined, fastOptions);

    expect(result).toEqual({ exists: true, digest: 'sha256:bearer' });
    expect(lastAuthorization).toBe('Bearer e2e-token');
    expect(requestCount).toBe(3);
  });

  it('retries a 503 over real sockets and then succeeds', async () => {
    handler = (_req, res, n) => {
      res.writeHead(n === 1 ? 503 : 200, { 'docker-content-digest': 'sha256:retry' });
      res.end();
    };

    const result = await checkManifest(baseUrl, 'repo/image', 'latest', undefined, fastOptions);

    expect(result.exists).toBe(true);
    expect(requestCount).toBe(2);
  });

  it('times out a hung request and retries it', async () => {
    handler = (_req, res, n) => {
      if (n === 1) return; // never respond: the client must time out
      res.writeHead(200, { 'docker-content-digest': 'sha256:after-timeout' });
      res.end();
    };

    const result = await checkManifest(baseUrl, 'repo/image', 'latest', undefined, fastOptions);

    expect(result.exists).toBe(true);
    expect(requestCount).toBe(2);
  });

  it('reports a rate-limit error after repeated 429s', async () => {
    handler = (_req, res) => {
      res.writeHead(429, { 'Retry-After': '0' });
      res.end();
    };

    await expect(
      checkManifest(baseUrl, 'repo/image', 'latest', undefined, fastOptions)
    ).rejects.toThrow(/Rate limited \(429\)/);
    expect(requestCount).toBe(3);
  });
});
