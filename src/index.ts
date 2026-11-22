import * as core from '@actions/core';
import { parseImageReference } from './image-parser';
import { getCredentials } from './credentials';
import { checkManifest } from './registry-client';

export async function run(): Promise<void> {
  // Input errors are configuration bugs, so they always fail the step,
  // regardless of fail-on-unknown.
  let image: string;
  let failOnUnknown: boolean;
  let failOnMissing: boolean;
  try {
    image = core.getInput('image', { required: true });
    failOnUnknown = core.getBooleanInput('fail-on-unknown');
    failOnMissing = core.getBooleanInput('fail-on-missing');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Invalid input: ${message}`);
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

    if (!result.exists && failOnMissing) {
      core.setFailed(`Image not found: ${image}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setOutput('error', message);
    if (failOnUnknown) {
      core.setFailed(message);
    } else {
      // Empty means "unknown": a registry error must not look like a missing image.
      core.setOutput('exists', '');
      core.warning(message);
    }
  }
}

if (!process.env.VITEST) {
  run().catch((error) => core.setFailed(error instanceof Error ? error.message : String(error)));
}
