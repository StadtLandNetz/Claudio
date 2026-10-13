# Deployment

Claudio runs on Kubernetes, built and rolled out by GitHub Actions on every push to `main` (same setup as
`automation-runner`).

```
push to main ─► release.yml ─► ci (typecheck, tests incl. Playwright, migrations, build)
                                └► image  (ghcr.io/vanderlars/claudio:sha-<commit>)
                                    └► deploy (kubectl apply k8s/, rollout, diagnostics, auto-rollback)
pull request ─► ci.yml (same checks, no deploy)
```

## What runs where

- **One image, two commands** (`Dockerfile`, based on Playwright's image with Chromium and git; Claude Code comes
  with the Agent SDK): web UI `node apps/web/build`, worker `tsx apps/worker/src/main.ts`, migrations
  `tsx packages/db/src/migrate.ts`.
- **One pod** (`k8s/deployment.yaml`) with the containers `web` and `worker` and the init container `migrate`.
  Unlike automation-runner they share a pod because the worker writes run files (screenshots, traces, live frames)
  that the web UI serves; both mount the volume `claudio-runs` (`k8s/pvc.yaml`, ReadWriteOnce). One replica,
  `Recreate` on deploy.
- **MySQL** outside the cluster (or `k8s/optional/mysql-statefulset.yaml` for staging).
- **Ingress** `k8s/ingress.yaml` with TLS via cert-manager. No basic auth: Claudio has its own GitHub login, and
  `/webhooks/github` must be reachable for GitHub (signed per repository).
- **No server-wide Anthropic key.** Every repository stores its own key in the UI; runs without one do not start.

## First-time setup (cluster admin, once)

1. **Host name**: adjust `claudio.nova-hub.app` in `k8s/ingress.yaml` and `ORIGIN`/`PUBLIC_BASE_URL` in
   `k8s/configmap.yaml`. Check `CLAUDIO_ALLOWED_GITHUB_ORGS` (who may sign in).
2. **GitHub OAuth App for production** (Settings → Developer settings → OAuth Apps): homepage
   `https://<host>`, callback `https://<host>/auth/github/callback`. Leave "Expire user access tokens" either way;
   Claudio renews expiring tokens.
3. **Database**: empty MySQL database with `DEFAULT CHARACTER SET utf8mb4`. The migrate init container needs
   CREATE, ALTER, DROP, INDEX, REFERENCES – either for the app user, or a separate user as `DATABASE_MIGRATION_URL`.
4. **Namespace and secret**:
   ```sh
   kubectl apply -f k8s/namespace.yaml
   ./tools/create-k8s-secret.sh      # registry login, DATABASE_URL, OAuth app, generates CLAUDIO_SECRET_KEY
   ```
   Back up `CLAUDIO_SECRET_KEY` (password manager): GitHub tokens, role credentials, webhook secrets and Anthropic
   keys in the database are encrypted with it.
5. **Deploy credentials for GitHub Actions**:
   ```sh
   ./tools/create-deploy-kubeconfig.sh   # ServiceAccount github-deployer (namespace-scoped, cannot read secrets)
                                          # and repository secret KUBECONFIG_B64
   ```
6. **First rollout**: push to `main` (or re-run the release workflow). The deploy job applies everything in `k8s/`
   except `namespace.yaml` and the subfolders.

## Every push to main

`release.yml` runs the CI, pushes `ghcr.io/<repo>:sha-<commit>` (and `latest`), sets that tag in
`k8s/deployment.yaml`, applies the manifests and waits for the rollout. Pods that cannot start
(missing secret key, image pull, failing migration) fail the job within seconds with their logs in the output;
the deployment is then rolled back. Deploys never run in parallel.

On a deploy the worker receives SIGTERM: running reviews, analyses and test runs are asked to stop (their cost is
still recorded) and end as "aborted"; queued ones wait for the new pod.

## Operations

- **Logs**: `kubectl -n claudio logs deploy/claudio -c worker` (or `-c web`, `-c migrate`).
- **Rollback by hand**: `kubectl -n claudio rollout undo deploy/claudio`.
- **Sizing**: one run = one Chromium + one Claude Code session (~0.5–1 GB). For more parallel runs raise
  `CLAUDIO_WORKER_CONCURRENCY` in the ConfigMap together with the worker's memory limit.
- **Disk**: run directories older than `CLAUDIO_RUN_RETENTION_DAYS` (60) are deleted by the worker; reports stay
  in the database. The volume has 20 GiB.
- **Image size**: ~3 GB, mostly the Playwright base image (it also contains Firefox and WebKit). A slimmer base
  with only Chromium is possible later.
