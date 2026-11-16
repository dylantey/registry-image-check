import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getCredentials } from '../src/credentials';

describe('getCredentials', () => {
  let tempDir: string;
  let originalDockerConfig: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-config-'));
    originalDockerConfig = process.env.DOCKER_CONFIG;
    process.env.DOCKER_CONFIG = tempDir;
  });

  afterEach(() => {
    if (originalDockerConfig === undefined) {
      delete process.env.DOCKER_CONFIG;
    } else {
      process.env.DOCKER_CONFIG = originalDockerConfig;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns credentials from auths entry', async () => {
    const config = {
      auths: {
        'my.registry.io': {
          auth: Buffer.from('user:pass').toString('base64'),
        },
      },
    };
    fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(config));

    const auth = await getCredentials('my.registry.io');
    expect(auth).toEqual({ username: 'user', password: 'pass' });
  });

  it('returns undefined when no docker config exists', async () => {
    const auth = await getCredentials('public.ecr.aws');
    expect(auth).toBeUndefined();
  });

  it('returns undefined when no matching credentials exist', async () => {
    const config = {
      auths: {
        'other.registry.io': {
          auth: Buffer.from('user:pass').toString('base64'),
        },
      },
    };
    fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(config));

    const auth = await getCredentials('public.ecr.aws');
    expect(auth).toBeUndefined();
  });
});
