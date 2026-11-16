import * as exec from '@actions/exec';
import { DockerAuth, DockerConfig, getAuthFromAuths, readDockerConfig } from './docker-config';

export async function getCredentials(registry: string): Promise<DockerAuth | undefined> {
  const config = readDockerConfig();
  if (!config) {
    return undefined;
  }

  // 1. Try direct auths entry
  const auth = getAuthFromAuths(config, registry);
  if (auth) return auth;

  // 2. Try registry-specific credential helper
  const helper = config.credHelpers?.[registry];
  if (helper) {
    return getCredentialsFromHelper(helper, registry);
  }

  // 3. Try global credential store
  if (config.credsStore) {
    return getCredentialsFromHelper(config.credsStore, registry);
  }

  // Public registries may not require credentials
  return undefined;
}

async function getCredentialsFromHelper(helper: string, registry: string): Promise<DockerAuth> {
  const helperName = `docker-credential-${helper}`;
  let output = '';

  await exec.exec(helperName, ['get'], {
    input: Buffer.from(`${registry}\n`),
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
    silent: true,
  });

  const parsed = JSON.parse(output);
  return {
    username: parsed.Username || '',
    password: parsed.Secret || '',
  };
}
