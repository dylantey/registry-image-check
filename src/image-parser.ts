export interface ImageReference {
  registry: string;
  repository: string;
  tag?: string;
  digest?: string;
}

export function parseImageReference(image: string): ImageReference {
  if (!image || !image.trim()) {
    throw new Error('Image reference is required');
  }

  const trimmed = image.trim();
  const parts = trimmed.split('/');

  let registry = 'docker.io';
  let repositoryParts: string[];

  if (parts.length > 1) {
    const first = parts[0];
    if (looksLikeRegistry(first)) {
      registry = first.toLowerCase();
      repositoryParts = parts.slice(1);
    } else {
      repositoryParts = parts;
    }
  } else {
    repositoryParts = parts;
  }

  let repositoryWithRef = repositoryParts.join('/');

  let digest: string | undefined;
  const atIndex = repositoryWithRef.lastIndexOf('@');
  if (atIndex !== -1) {
    digest = repositoryWithRef.substring(atIndex + 1);
    repositoryWithRef = repositoryWithRef.substring(0, atIndex);
  }

  let tag: string | undefined;
  const colonIndex = repositoryWithRef.lastIndexOf(':');
  if (colonIndex !== -1) {
    const afterColon = repositoryWithRef.substring(colonIndex + 1);
    if (isValidTag(afterColon)) {
      tag = afterColon;
      repositoryWithRef = repositoryWithRef.substring(0, colonIndex);
    }
  }

  let repository = repositoryWithRef;

  // Docker Hub default namespace
  if (registry === 'docker.io' && !repository.includes('/')) {
    repository = `library/${repository}`;
  }

  if (!repository) {
    throw new Error(`Invalid image reference: ${image}`);
  }

  return { registry, repository, tag, digest };
}

function looksLikeRegistry(value: string): boolean {
  return value.includes('.') || value.includes(':') || value.toLowerCase() === 'localhost';
}

function isValidTag(tag: string): boolean {
  return tag.length > 0 && !tag.includes(':') && !tag.includes('@') && !tag.includes('/');
}
