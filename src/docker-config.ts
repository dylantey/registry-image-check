import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DockerAuth {
  username: string;
  password: string;
}

export interface DockerAuthEntry {
  auth?: string;
  username?: string;
  password?: string;
}

export interface DockerConfig {
  auths?: Record<string, DockerAuthEntry>;
  credHelpers?: Record<string, string>;
  credsStore?: string;
}

export function readDockerConfig(): DockerConfig | null {
  const dockerConfigPath = getDockerConfigPath();
  if (!fs.existsSync(dockerConfigPath)) {
    return null;
  }

  const content = fs.readFileSync(dockerConfigPath, 'utf8');
  return JSON.parse(content) as DockerConfig;
}

function getDockerConfigPath(): string {
  const dockerConfigEnv = process.env.DOCKER_CONFIG;
  if (dockerConfigEnv) {
    return path.join(dockerConfigEnv, 'config.json');
  }
  return path.join(os.homedir(), '.docker', 'config.json');
}

export function getAuthFromAuths(config: DockerConfig, registry: string): DockerAuth | null {
  if (!config.auths) return null;

  const candidates = [registry, `https://${registry}`, `http://${registry}`];

  for (const key of candidates) {
    const entry = config.auths[key];
    if (!entry) continue;

    if (entry.auth) {
      const decoded = Buffer.from(entry.auth, 'base64').toString('utf8');
      const sepIndex = decoded.indexOf(':');
      if (sepIndex === -1) {
        return { username: decoded, password: '' };
      }
      return {
        username: decoded.substring(0, sepIndex),
        password: decoded.substring(sepIndex + 1),
      };
    }

    if (entry.username !== undefined && entry.password !== undefined) {
      return { username: entry.username, password: entry.password };
    }
  }

  return null;
}
