# Deployment

Claudio runs on Kubernetes, built and rolled out by GitHub Actions on every push to `main` (same setup as
`automation-runner`).

```
push to main ─► release.yml ─► ci (typecheck, tests incl. Playwright, migrations, build)
                                └► image  (ghcr.io/stadtlandnetz/claudio:sha-<commit>)
                                    └► deploy (kubectl apply k8s/, rollout, diagnostics, auto-rollback)
pull request ─► ci.yml (same checks, no deploy)
```

## What runs where

- **One image, two commands** (`Dockerfile`, based on Playwright's image with Chromium and git; Claude Code comes
  with the Agent SDK): web UI `node apps/web/build`, worker `tsx apps/worker/src/main.ts`, migrations
  `tsx packages/db/src/migrate.ts`.
- **One pod** (`k8s/deployment.yaml`) with the containers `web` and `worker` and the init container `migrate`.
  Unlike automation-runner they share a pod: during a run the web UI shows the live frames and offers the trace the
  worker writes into the shared run directory. That directory is an `emptyDir` – **no persistent volume**; nothing
  on disk has to survive a deploy. One replica, `Recreate` on deploy.
- **All state in MySQL**, including screenshots: after each run the worker stores the evidence images in
  `run_artifacts`; they are deleted after `CLAUDIO_ARTIFACT_RETENTION_DAYS` (14). Reports, findings and costs stay.
  Traces and agent transcripts live only in the run directory and are gone after a deploy.
- **MySQL** outside the cluster (or `k8s/optional/mysql-statefulset.yaml` for staging).
- **Ingress** `k8s/ingress.yaml` with TLS via cert-manager. No basic auth: Claudio has its own GitHub/GitLab login,
  and `/webhooks/github` and `/webhooks/gitlab` must be reachable (each delivery carries the repository's secret).
- **No server-wide Anthropic key.** Every repository stores its own key in the UI; runs without one do not start.

## First-time setup (cluster admin, once)

1. **Host name**: `claudio.stadtlandnetz.de` (in `k8s/ingress.yaml` and `ORIGIN`/`PUBLIC_BASE_URL` in
   `k8s/configmap.yaml`). The DNS record must point to the cluster's ingress before the first rollout, otherwise
   cert-manager cannot issue the certificate. Check `CLAUDIO_ALLOWED_GITHUB_ORGS` (who may sign in).
2. **GitHub OAuth App for production** (Settings → Developer settings → OAuth Apps): homepage
   `https://claudio.stadtlandnetz.de`, callback `https://claudio.stadtlandnetz.de/auth/github/callback`. Leave "Expire user access tokens" either way;
   Claudio renews expiring tokens.
3. **Database**: empty MySQL database with `DEFAULT CHARACTER SET utf8mb4`. The migrate init container needs
   CREATE, ALTER, DROP, INDEX, REFERENCES – either for the app user, or a separate user as `DATABASE_MIGRATION_URL`.
4. **Namespace and secret**:
   ```sh
   kubectl apply -f k8s/namespace.yaml
   ./tools/create-k8s-secret.sh      # registry login, DATABASE_URL, OAuth app, generates CLAUDIO_SECRET_KEY
   ```
   Back up `CLAUDIO_SECRET_KEY` (password manager): GitHub/GitLab tokens, role credentials, webhook secrets and Anthropic
   keys in the database are encrypted with it.
5. **Deploy credentials for GitHub Actions**:
   ```sh
   ./tools/create-deploy-kubeconfig.sh   # ServiceAccount github-deployer (namespace-scoped, cannot read secrets)
                                          # and repository secret KUBECONFIG_B64
   ```
6. **First rollout**: push to `main` (or re-run the release workflow). The deploy job applies everything in `k8s/`
   except `namespace.yaml` and the subfolders.

## Optional: Claudio as a GitHub App

Without an app, Claudio writes to GitHub with the token of the person who set up a repository's automation. With an app, comments, PR reviews, commit statuses and issues come from "Claudio[bot]".

1. **Create the app.** For an organisation, go to GitHub → organisation → Settings → Developer settings → GitHub Apps → New GitHub App. For a personal account, use Settings → Developer settings.
   - Name: e.g. `Claudio StadtLandNetz`. The slug is shown later in the app's URL `github.com/apps/<slug>`.
   - Homepage URL: the `PUBLIC_BASE_URL`.
   - Webhook: active, URL `<PUBLIC_BASE_URL>/webhooks/github`, and a secret (`openssl rand -hex 32`). Deactivate it if you keep the per-repository webhooks.
   - Repository permissions: Contents read, Metadata read, Pull requests read and write, Issues read and write, Commit statuses read and write, Deployments read.
   - Subscribe to events: Issue comment, Pull request, Push, Deployment status.
   - Where can this app be installed: only on this account.
2. **Note the App ID** at the top of the app's page, then under "Private keys" choose **Generate a private key**. GitHub downloads a `.pem` file.
3. **Install the app** (Install App → the organisation) on all repositories or on the ones set up in Claudio.
4. **Give Claudio the values:** run `./tools/create-k8s-secret.sh` again and fill in the GitHub App section (App ID, slug, path to the `.pem` file, webhook secret). Everything else is kept when left empty. Then restart: `kubectl -n claudio rollout restart deployment/claudio`.
5. **Check:** in a repository's settings tab, the "GitHub App" box says "Installed". If the app's webhook is active, the per-repository webhook can be removed there.

Locally, the same values go into `.env` (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` with `\n` for line breaks, `GITHUB_APP_WEBHOOK_SECRET`).

## Optional: GitLab

GitLab (gitlab.com or a self-managed instance) can be connected next to GitHub. People then choose on the sign-in page; each account sees the repositories of its own provider.

1. **Who may sign in.** Set `CLAUDIO_ALLOWED_GITLAB_GROUPS` (group paths; members of subgroups count) or `CLAUDIO_ALLOWED_GITLAB_USERS` in `k8s/configmap.yaml` **before** enabling the login. As long as only the GitHub lists are set, nobody can sign in with GitLab. For a self-managed instance, set `GITLAB_URL` there too.
2. **OAuth application.** On GitLab → (group or admin area, or a user's) Settings → Applications → Add new application: redirect URI `https://claudio.stadtlandnetz.de/auth/gitlab/callback`, *Confidential* on, scope `api`. GitLab's access tokens expire after two hours; Claudio renews them with the refresh token.
3. **Optional bot user.** Without it, comments, statuses and issues come from the person who set up a repository's webhook or started the run. For Claudio's own identity, create a GitLab user (e.g. `claudio-bot`), invite it as *Developer* to the projects, and create a personal access token for it with scope `api`. Such tokens expire after at most a year: the repository settings show the date and warn two weeks before; renew the token and update the secret in time.
4. **Give Claudio the values:** run `./tools/create-k8s-secret.sh` again and fill in the GitLab sections (application ID and secret, bot token). Everything else is kept when left empty. Then `kubectl apply -f k8s/configmap.yaml` and `kubectl -n claudio rollout restart deployment/claudio`.
5. **Per project:** sign in with GitLab, add the project under Repositories, and set up the webhook in its settings (needs the Maintainer role). The settings show the bot's role on the project.

Limits on GitLab: requested changes block merging only in Premium and Ultimate; merge requests from forks are reviewed without a code checkout (as pull requests from forks on GitHub).

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
- **Storage**: screenshots take roughly 0.5–2 MB per review in MySQL for 14 days. The run directory (`emptyDir`,
  10 GiB limit) is cleared on every deploy and after `CLAUDIO_RUN_RETENTION_DAYS` (14).
- **Image size**: ~3 GB, mostly the Playwright base image (it also contains Firefox and WebKit). A slimmer base
  with only Chromium is possible later.
