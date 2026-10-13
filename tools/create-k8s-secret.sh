#!/usr/bin/env bash
# Creates or updates the single Kubernetes secret `claudio-secrets` interactively:
#   .dockerconfigjson      – ghcr.io login for pulling the private image (verified against the registry)
#   DATABASE_URL           – MySQL connection string (password is URL-encoded)
#   DATABASE_MIGRATION_URL – optional: user with DDL privileges for the migrate init container (kept if already set)
#   CLAUDIO_SECRET_KEY     – encrypts tokens and credentials in the database (kept if the secret already has one)
#   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET – the GitHub OAuth App for the login
# Run it in an interactive terminal:  ./tools/create-k8s-secret.sh
set -euo pipefail

NS=${NAMESPACE:-claudio}
IMAGE_REPO=${IMAGE_REPO:-stadtlandnetz/claudio}
SECRET=claudio-secrets

for tool in kubectl node curl base64 openssl; do
	command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done
kubectl get namespace "$NS" >/dev/null 2>&1 || { echo "namespace $NS does not exist – run: kubectl apply -f k8s/namespace.yaml" >&2; exit 1; }

existing() { kubectl -n "$NS" get secret "$SECRET" -o jsonpath="{.data.$1}" 2>/dev/null | base64 -d || true; }

echo "== Registry login (ghcr.io) =="
read -rp "GitHub user: " GH_USER
read -rsp "GitHub PAT with scope read:packages: " GH_PAT; echo
[ -n "$GH_PAT" ] || { echo "PAT must not be empty" >&2; exit 1; }
if curl -fsS -u "$GH_USER:$GH_PAT" "https://ghcr.io/token?scope=repository:${IMAGE_REPO}:pull" >/dev/null; then
	echo "   ghcr.io accepted the credentials"
else
	echo "   ghcr.io rejected the credentials (check user, token scope read:packages, org SSO authorization)" >&2
	exit 1
fi

echo "== Database =="
read -rp "MySQL host[:port] (e.g. mysql.internal:3306): " DB_HOST
[ -n "$DB_HOST" ] || { echo "host must not be empty" >&2; exit 1; }
read -rp "MySQL database [claudio]: " DB_NAME; DB_NAME=${DB_NAME:-claudio}
read -rp "MySQL user [claudio]: " DB_USER; DB_USER=${DB_USER:-claudio}
read -rsp "MySQL password: " DB_PASS; echo
[ -n "$DB_PASS" ] || { echo "password must not be empty" >&2; exit 1; }
enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
DATABASE_URL="mysql://$(enc "$DB_USER"):$(enc "$DB_PASS")@${DB_HOST}/${DB_NAME}"

echo "== Migration user (optional) =="
echo "   Migrations need CREATE, ALTER, DROP, INDEX, REFERENCES. Leave empty if the app user has them (or to keep an existing value)."
read -rp "MySQL migration user (empty = use the app user): " MIG_USER
MIG_ARGS=()
if [ -n "$MIG_USER" ]; then
	read -rsp "MySQL migration password: " MIG_PASS; echo
	[ -n "$MIG_PASS" ] || { echo "password must not be empty" >&2; exit 1; }
	MIG_ARGS=(--from-literal=DATABASE_MIGRATION_URL="mysql://$(enc "$MIG_USER"):$(enc "$MIG_PASS")@${DB_HOST}/${DB_NAME}")
else
	MIG_EXISTING=$(existing DATABASE_MIGRATION_URL)
	if [ -n "$MIG_EXISTING" ]; then
		echo "   keeping the existing DATABASE_MIGRATION_URL"
		MIG_ARGS=(--from-literal=DATABASE_MIGRATION_URL="$MIG_EXISTING")
	fi
fi

echo "== GitHub OAuth App (login) =="
BASE_URL=$(sed -n 's/^ *PUBLIC_BASE_URL: *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$(dirname "$0")/../k8s/configmap.yaml")
echo "   Callback URL of the app: ${BASE_URL:-https://<host>}/auth/github/callback"
read -rp "Client ID: " GH_CLIENT_ID
[ -n "$GH_CLIENT_ID" ] || GH_CLIENT_ID=$(existing GITHUB_CLIENT_ID)
[ -n "$GH_CLIENT_ID" ] || { echo "client id must not be empty" >&2; exit 1; }
read -rsp "Client secret (empty = keep existing): " GH_CLIENT_SECRET; echo
[ -n "$GH_CLIENT_SECRET" ] || GH_CLIENT_SECRET=$(existing GITHUB_CLIENT_SECRET)
[ -n "$GH_CLIENT_SECRET" ] || { echo "client secret must not be empty" >&2; exit 1; }

echo "== Encryption key =="
# Never replace an existing key: tokens, role credentials, webhook secrets and Anthropic keys are encrypted with it
ENC_KEY=$(existing CLAUDIO_SECRET_KEY)
if [ -n "$ENC_KEY" ]; then
	echo "   keeping the existing key"
else
	ENC_KEY=$(openssl rand -base64 32)
	echo "   generated a new key – back it up (password manager), without it all stored credentials are lost"
fi

DOCKERCFG=$(printf '{"auths":{"ghcr.io":{"auth":"%s"}}}' "$(printf '%s:%s' "$GH_USER" "$GH_PAT" | base64 | tr -d '\n')")

kubectl -n "$NS" create secret generic "$SECRET" \
	--type=kubernetes.io/dockerconfigjson \
	--from-literal=.dockerconfigjson="$DOCKERCFG" \
	--from-literal=DATABASE_URL="$DATABASE_URL" \
	--from-literal=CLAUDIO_SECRET_KEY="$ENC_KEY" \
	--from-literal=GITHUB_CLIENT_ID="$GH_CLIENT_ID" \
	--from-literal=GITHUB_CLIENT_SECRET="$GH_CLIENT_SECRET" \
	${MIG_ARGS[@]+"${MIG_ARGS[@]}"} \
	--dry-run=client -o yaml | kubectl apply -f -

unset GH_PAT DB_PASS DOCKERCFG DATABASE_URL ENC_KEY MIG_PASS MIG_ARGS MIG_EXISTING GH_CLIENT_SECRET
echo
echo "Secret $SECRET in namespace $NS is ready:"
echo "  registry user $GH_USER, database $DB_USER@$DB_HOST/$DB_NAME, OAuth client $GH_CLIENT_ID"
echo "Next: check host in k8s/ingress.yaml and ORIGIN/PUBLIC_BASE_URL in k8s/configmap.yaml, then: kubectl apply -f k8s/"
