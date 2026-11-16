import * as https from 'https';
import * as http from 'http';
import { DockerAuth } from './docker-config';

export interface CheckResult {
  exists: boolean;
  digest?: string;
}

export async function checkManifest(
  registry: string,
  repository: string,
  reference: string,
  auth?: DockerAuth
): Promise<CheckResult> {
  const encodedRepository = encodeURIComponent(repository).replace(/%2F/g, '/');
  const path = `/v2/${encodedRepository}/manifests/${encodeURIComponent(reference)}`;

  const isHttps = !registry.startsWith('http://');
  const hostname = registry.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
  const portMatch = registry.match(/:(\d+)$/);
  const port = portMatch ? parseInt(portMatch[1], 10) : undefined;

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

  const options: https.RequestOptions = {
    method: 'HEAD',
    hostname,
    port,
    path,
    headers,
  };

  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(options, (res) => {
      const digest = res.headers['docker-content-digest'] as string | undefined;

      if (res.statusCode === 200) {
        resolve({ exists: true, digest });
      } else if (res.statusCode === 404) {
        resolve({ exists: false });
      } else if (res.statusCode === 401) {
        reject(new Error(`Unauthorized (401) for ${registry}. Check your credentials.`));
      } else if (res.statusCode === 403) {
        reject(new Error(`Forbidden (403) for ${registry}. Check your permissions.`));
      } else {
        reject(new Error(`Unexpected status ${res.statusCode} from registry`));
      }
    });

    req.on('error', reject);
    req.end();
  });
}
