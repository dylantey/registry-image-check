import * as core from '@actions/core';
import { parseImageReference } from './image-parser';
import { getCredentials } from './credentials';
import { checkManifest } from './registry-client';

export async function run(): Promise<void> {
  const image = core.getInput('image', { required: true });

  let failOnError: boolean;
  let failIfMissing: boolean;
  try {
    failOnError = core.getBooleanInput('fail-on-error');
    failIfMissing = core.getBooleanInput('fail-if-missing');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Invalid boolean input: ${message}`);
    return;
  }

  try {
    const ref = parseImageReference(image);
    core.info(`Checking ${ref.registry}/${ref.repository}...`);

    if (!ref.tag && !ref.digest) {
      throw new Error('Image reference must include a tag or digest');
    }

    const reference = ref.digest || ref.tag!;
    const auth = await getCredentials(ref.registry);

    const result = await checkManifest(ref.registry, ref.repository, reference, auth);

    core.setOutput('exists', result.exists.toString());
    if (result.digest) {
      core.setOutput('digest', result.digest);
    }

    core.info(`Image exists: ${result.exists}`);
    if (result.digest) {
      core.info(`Digest: ${result.digest}`);
    }

    if (!result.exists && failIfMissing) {
      core.setFailed(`Image not found: ${image}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setOutput('error', message);
    if (failOnError) {
      core.setFailed(message);
    } else {
      // Empty means "unknown": a registry error must not look like a missing image.
      core.setOutput('exists', '');
      core.warning(message);
    }
  }
}

if (!process.env.VITEST) {
  run();
}
