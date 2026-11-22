# registry-image-check

A GitHub Action that checks whether a container image exists in a registry **without using the Docker daemon**.

Works with:

- Amazon ECR
- Azure ACR
- Google Container Registry (GCR)
- Google Artifact Registry
- Any Docker registry accessible via the OCI Distribution API

## Why

`docker manifest inspect` requires the Docker daemon. This action calls the registry API directly, so it runs faster and works in environments where Docker is unavailable.

## Usage

Log in to your registry first, then use this action.

### ECR example

```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789012:role/my-role
    aws-region: us-east-1

- uses: aws-actions/amazon-ecr-login@v2

- uses: dylantey/registry-image-check@v1
  id: check
  with:
    image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:${{ github.sha }}

- run: echo ${{ steps.check.outputs.exists }}
```

### ACR example

```yaml
- uses: azure/docker-login@v1
  with:
    login-server: myregistry.azurecr.io
    username: ${{ secrets.AZURE_CLIENT_ID }}
    password: ${{ secrets.AZURE_CLIENT_SECRET }}

- uses: dylantey/registry-image-check@v1
  with:
    image: myregistry.azurecr.io/my-repo:${{ github.sha }}
```

### GCR / Artifact Registry example

```yaml
- id: auth
  uses: google-github-actions/auth@v2
  with:
    token_format: access_token
    workload_identity_provider: projects/.../locations/global/workloadIdentityPools/.../providers/...
    service_account: ...

- uses: docker/login-action@v3
  with:
    registry: us-docker.pkg.dev
    username: oauth2accesstoken
    password: ${{ steps.auth.outputs.access_token }}

- uses: dylantey/registry-image-check@v1
  with:
    image: us-docker.pkg.dev/my-project/my-repo/my-image:${{ github.sha }}
```

### Build only when the image is missing

Set `fail-if-missing: false` so a missing image doesn't fail the step, then gate the build on `exists`:

```yaml
- uses: dylantey/registry-image-check@v1
  id: check
  with:
    image: ghcr.io/my-org/my-app:${{ github.sha }}
    fail-if-missing: false

# Compare with 'false' rather than '!= true': if the check itself failed,
# exists is empty and the build should not run.
- name: Build and push
  if: steps.check.outputs.exists == 'false'
  # Assumes a prior step has logged in to ghcr.io (e.g. docker/login-action)
  run: |
    docker build -t ghcr.io/my-org/my-app:${{ github.sha }} .
    docker push ghcr.io/my-org/my-app:${{ github.sha }}
```

## Inputs

| Name              | Required | Default | Description                                                |
| ----------------- | -------- | ------- | ---------------------------------------------------------- |
| `image`           | yes      |         | Full image reference, including registry and tag or digest |
| `fail-on-error`   | no       | `true`  | Fail the step on registry errors other than 404            |
| `fail-if-missing` | no       | `true`  | Fail the step if the image does not exist (404)            |

## Outputs

| Name     | Description                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| `exists` | `true` if the image exists, `false` if the registry reports it missing, empty if the check failed (see below) |
| `digest` | Manifest digest, if the image exists                                                                         |
| `error`  | Error message if the check failed                                                                            |

When `fail-on-error` is `false`, a failed check leaves `exists` empty rather than `false`, so a registry outage or rate limit is never mistaken for a missing image. Check `exists` for `'true'`/`'false'` before building.

## How it works

1. Reads credentials from `~/.docker/config.json` after you log in.
2. Supports direct `auths` entries and `credHelpers` / `credsStore`.
3. Sends a `HEAD` request to `/v2/<repository>/manifests/<tag-or-digest>`.
4. Returns `exists=true` on HTTP 200 and `exists=false` on HTTP 404.
5. Retries up to 3 attempts on network errors, timeouts (10s), 5xx and 429, with backoff. A 429 `Retry-After` is honored up to 30s.

Unqualified image names such as `ubuntu:22.04` default to Docker Hub (`docker.io/library/ubuntu:22.04`), using `registry-1.docker.io` for API requests.

Anonymous pulls from Docker Hub are rate limited. If you see a 429 error, run `docker login` before the check, or pass registry credentials.

## Development

```bash
npm install
npm run build
npm run test
npm run bundle
```

The bundled output in `dist/` is what the action runs.
