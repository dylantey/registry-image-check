import * as core from '@actions/core';
import { parseImageReference } from './image-parser';
import { getCredentials } from './credentials';
import { checkManifest } from './registry-client';

async function run(): Promise<void> {
  const image = core.getInput('image', { required: true });
  const failOnError = core.getBooleanInput('fail-on-error');

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
  } catch (error) {
    if (failOnError) {
      core.setFailed(error instanceof Error ? error.message : String(error));
    } else {
      core.setOutput('exists', 'false');
      core.warning(error instanceof Error ? error.message : String(error));
    }
  }
}

run();
