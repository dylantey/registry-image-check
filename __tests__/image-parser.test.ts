import { describe, it, expect } from 'vitest';
import { parseImageReference } from '../src/image-parser';

describe('parseImageReference', () => {
  it('parses ECR image with tag', () => {
    const ref = parseImageReference('123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:abc123');
    expect(ref.registry).toBe('123456789012.dkr.ecr.us-east-1.amazonaws.com');
    expect(ref.repository).toBe('my-repo');
    expect(ref.tag).toBe('abc123');
    expect(ref.digest).toBeUndefined();
  });

  it('parses ACR image with digest', () => {
    const ref = parseImageReference('myregistry.azurecr.io/project/repo@sha256:abcdef');
    expect(ref.registry).toBe('myregistry.azurecr.io');
    expect(ref.repository).toBe('project/repo');
    expect(ref.digest).toBe('sha256:abcdef');
    expect(ref.tag).toBeUndefined();
  });

  it('parses Artifact Registry image', () => {
    const ref = parseImageReference('us-docker.pkg.dev/my-project/my-repo/my-image:latest');
    expect(ref.registry).toBe('us-docker.pkg.dev');
    expect(ref.repository).toBe('my-project/my-repo/my-image');
    expect(ref.tag).toBe('latest');
  });

  it('parses GCR image', () => {
    const ref = parseImageReference('gcr.io/project/image:latest');
    expect(ref.registry).toBe('gcr.io');
    expect(ref.repository).toBe('project/image');
    expect(ref.tag).toBe('latest');
  });

  it('defaults to docker.io with library prefix', () => {
    const ref = parseImageReference('nginx:latest');
    expect(ref.registry).toBe('docker.io');
    expect(ref.repository).toBe('library/nginx');
    expect(ref.tag).toBe('latest');
  });

  it('throws on empty input', () => {
    expect(() => parseImageReference('')).toThrow('Image reference is required');
  });
});
