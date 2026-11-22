import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as core from '@actions/core';
import { parseImageReference } from '../src/image-parser';
import { getCredentials } from '../src/credentials';
import { checkManifest } from '../src/registry-client';
import { run } from '../src/index';

vi.mock('@actions/core');
vi.mock('../src/image-parser');
vi.mock('../src/credentials');
vi.mock('../src/registry-client');

const mockedCore = vi.mocked(core);
const mockedParseImageReference = vi.mocked(parseImageReference);
const mockedGetCredentials = vi.mocked(getCredentials);
const mockedCheckManifest = vi.mocked(checkManifest);

describe('run', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedParseImageReference.mockReturnValue({
      registry: 'registry.io',
      repository: 'repo/image',
      tag: 'latest',
    });
    mockedGetCredentials.mockResolvedValue(undefined);
    mockedCore.getInput.mockImplementation((name: string) => {
      if (name === 'image') return 'registry.io/repo/image:latest';
      if (name === 'fail-on-unknown') return 'true';
      if (name === 'fail-on-missing') return 'false';
      return '';
    });
    mockedCore.getBooleanInput.mockImplementation((name: string) => {
      if (name === 'fail-on-unknown') return true;
      if (name === 'fail-on-missing') return true;
      return false;
    });
  });

  it('sets outputs when image exists', async () => {
    mockedCheckManifest.mockResolvedValue({ exists: true, digest: 'sha256:abc' });

    await run();

    expect(mockedCore.setOutput).toHaveBeenCalledWith('exists', 'true');
    expect(mockedCore.setOutput).toHaveBeenCalledWith('digest', 'sha256:abc');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  it('sets exists=false and does not fail when image is missing and fail-on-missing is false', async () => {
    mockedCore.getBooleanInput.mockImplementation((name: string) => {
      if (name === 'fail-on-unknown') return true;
      if (name === 'fail-on-missing') return false;
      return false;
    });
    mockedCheckManifest.mockResolvedValue({ exists: false });

    await run();

    expect(mockedCore.setOutput).toHaveBeenCalledWith('exists', 'false');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  it('fails when image is missing and fail-on-missing is true', async () => {
    mockedCore.getBooleanInput.mockImplementation((name: string) => {
      if (name === 'fail-on-unknown') return true;
      if (name === 'fail-on-missing') return true;
      return false;
    });
    mockedCheckManifest.mockResolvedValue({ exists: false });

    await run();

    expect(mockedCore.setOutput).toHaveBeenCalledWith('exists', 'false');
    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      'Image not found: registry.io/repo/image:latest'
    );
  });

  it('leaves exists empty and sets error when the check fails and fail-on-unknown is false', async () => {
    mockedCore.getBooleanInput.mockImplementation((name: string) => {
      if (name === 'fail-on-unknown') return false;
      if (name === 'fail-on-missing') return true;
      return false;
    });
    mockedCheckManifest.mockRejectedValue(new Error('Rate limited (429) by registry.io.'));

    await run();

    expect(mockedCore.setOutput).toHaveBeenCalledWith('exists', '');
    expect(mockedCore.setOutput).toHaveBeenCalledWith('error', 'Rate limited (429) by registry.io.');
    expect(mockedCore.setOutput).not.toHaveBeenCalledWith('exists', 'false');
    expect(mockedCore.setFailed).not.toHaveBeenCalled();
  });

  it('fails with a clear message when a boolean input is invalid', async () => {
    mockedCore.getBooleanInput.mockImplementation(() => {
      throw new TypeError('Input does not meet YAML 1.2 Core Schema specification: fail-on-missing');
    });

    await run();

    expect(mockedCheckManifest).not.toHaveBeenCalled();
    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringMatching(/^Invalid input: .*fail-on-missing/)
    );
  });

  it('fails when the required image input is missing, even with fail-on-unknown false', async () => {
    mockedCore.getBooleanInput.mockImplementation((name: string) => name !== 'fail-on-unknown');
    mockedCore.getInput.mockImplementation(() => {
      throw new Error('Input required and not supplied: image');
    });

    await run();

    expect(mockedCheckManifest).not.toHaveBeenCalled();
    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('image'));
  });

  it('sets error and fails the step when the check fails and fail-on-unknown is true', async () => {
    mockedCheckManifest.mockRejectedValue(new Error('Forbidden (403) for registry.io.'));

    await run();

    expect(mockedCore.setOutput).toHaveBeenCalledWith('error', 'Forbidden (403) for registry.io.');
    expect(mockedCore.setFailed).toHaveBeenCalledWith('Forbidden (403) for registry.io.');
  });
});
