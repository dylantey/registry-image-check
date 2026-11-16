import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { DockerAuth } from './docker-config';

export interface CheckResult {
  exists: boolean;
  digest?: string;
}

interface RequestResult {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body?: string;
}

export async function checkManifest(
  registry: string,
  repository: string,
  reference: string,
  auth?: DockerAuth
): Promise<CheckResult> {
  const encodedRepository = encodeURIComponent(repository).replace(/%2F/g, '/');
  const path = `/v2/${encodedRepository}/manifests/${encodeURIComponent(reference)}`;

  const result = await request(registry, path, 'HEAD', buildHeaders(auth));

  if (result.statusCode === 401 && result.headers['www-authenticate']) {
    const bearerAuth = parseBearerChallenge(result.headers['www-authenticate'] as string);
    if (bearerAuth) {
      const token = await fetchBearerToken(bearerAuth, auth);
      const tokenResult = await request(registry, path, 'HEAD', {
        ...buildHeaders(auth),
        Authorization: `Bearer ${token}`,
      });
      return handleRegistryResponse(tokenResult, registry);
    }
  }

  return handleRegistryResponse(result, registry);
}

function buildHeaders(auth?: DockerAuth): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: [
      'application/vnd.docker.distribution.manifest.v2+json',
      'application/vnd.docker.distribution.manifest.list.v2+json',
      'application/vnd.oci.image.manifest.v1+json',
      'application/vnd.oci.image.index.v1+json',
    ].join(', '),
    'User-Agent': 'registry-image-check',
  };

  if (auth) {
    headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
  }

  return headers;
}

function handleRegistryResponse(result: RequestResult, registry: string): CheckResult {
  const digest = result.headers['docker-content-digest'] as string | undefined;

  if (result.statusCode === 200) {
    return { exists: true, digest };
  } else if (result.statusCode === 404) {
    return { exists: false };
  } else if (result.statusCode === 401) {
    throw new Error(`Unauthorized (401) for ${registry}. Check your credentials.`);
  } else if (result.statusCode === 403) {
    throw new Error(`Forbidden (403) for ${registry}. Check your permissions.`);
  } else {
    throw new Error(`Unexpected status ${result.statusCode} from registry`);
  }
}

function parseConnectionOptions(registry: string): {
  isHttps: boolean;
  hostname: string;
  port?: number;
} {
  const isHttps = !registry.startsWith('http://');
  const hostname = registry.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
  const portMatch = registry.match(/:(\d+)$/);
  const port = portMatch ? parseInt(portMatch[1], 10) : undefined;
  return { isHttps, hostname, port };
}

function request(
  registry: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  readBody = false
): Promise<RequestResult> {
  const { isHttps, hostname, port } = parseConnectionOptions(registry);
  const client = isHttps ? https : http;

  const options: https.RequestOptions = {
    method,
    hostname,
    port,
    path,
    headers,
  };

  return new Promise((resolve, reject) => {
    const req = client.request(options, (res) => {
      if (!readBody) {
        res.resume();
        resolve({ statusCode: res.statusCode || 0, headers: res.headers });
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, headers: res.headers, body: data });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

interface BearerChallenge {
  realm: string;
  service?: string;
  scope?: string;
}

function parseBearerChallenge(header: string): BearerChallenge | null {
  if (!header.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  const params = header.substring(7).trim();
  const result: BearerChallenge = { realm: '' };

  for (const part of params.split(',')) {
    const [key, ...valueParts] = part.split('=');
    const value = valueParts.join('=').replace(/^"/, '').replace(/"$/, '');
    if (key.trim() === 'realm') result.realm = value;
    if (key.trim() === 'service') result.service = value;
    if (key.trim() === 'scope') result.scope = value;
  }

  if (!result.realm) return null;
  return result;
}

async function fetchBearerToken(challenge: BearerChallenge, auth?: DockerAuth): Promise<string> {
  const url = new URL(challenge.realm);
  if (challenge.service) url.searchParams.set('service', challenge.service);
  if (challenge.scope) url.searchParams.set('scope', challenge.scope);

  const headers: Record<string, string> = {
    'User-Agent': 'registry-image-check',
  };

  if (auth) {
    headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
  }

  const response = await request(url.origin, `${url.pathname}${url.search}`, 'GET', headers, true);

  if (response.statusCode !== 200) {
    throw new Error(`Failed to fetch registry token: status ${response.statusCode}`);
  }

  try {
    const parsed = JSON.parse(response.body || '{}');
    if (parsed.token) {
      return parsed.token;
    }
    if (parsed.access_token) {
      return parsed.access_token;
    }
    throw new Error('Registry token response did not contain a token');
  } catch (err) {
    if (err instanceof Error && err.message.includes('token response')) {
      throw err;
    }
    throw new Error(`Failed to parse registry token response: ${err instanceof Error ? err.message : String(err)}`);
  }
}
