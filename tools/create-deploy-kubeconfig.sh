#!/usr/bin/env bash
# Sets up the credentials for the GitHub Actions deploy job (release.yml → job "deploy"):
#   1. applies k8s/admin/github-deployer.yaml (ServiceAccount + Role + RoleBinding + token Secret)
#   2. builds a kubeconfig for that ServiceAccount from the CURRENT kubectl context
#   3. verifies the permissions and stores the kubeconfig as repository secret KUBECONFIG_B64 (via gh)
# Run as a cluster admin with the target cluster selected:  ./tools/create-deploy-kubeconfig.sh [--yes]
# Env: NAMESPACE (claudio), GH_REPO (VanDerLars/Claudio), SET_GH_SECRET=0 to only print the command.
set -euo pipefail

NS=${NAMESPACE:-claudio}
SA=github-deployer
REPO=${GH_REPO:-VanDerLars/Claudio}
MANIFEST="$(dirname "$0")/../k8s/admin/github-deployer.yaml"

for tool in kubectl base64; do
	command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done

CTX=$(kubectl config current-context)
SERVER=$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')
echo "== Target: context $CTX, server $SERVER, namespace $NS =="
if [ "${1:-}" != "--yes" ]; then
	read -rp "Continue? [y/N] " answer
	[ "$answer" = "y" ] || { echo "aborted"; exit 1; }
fi

echo "== Applying $MANIFEST =="
kubectl apply -f "$MANIFEST"

echo "== Waiting for the token controller =="
TOKEN=""
for _ in $(seq 1 30); do
	TOKEN=$(kubectl -n "$NS" get secret "$SA-token" -o jsonpath='{.data.token}' 2>/dev/null | base64 -d || true)
	[ -n "$TOKEN" ] && break
	sleep 1
done
[ -n "$TOKEN" ] || { echo "token of secret $SA-token was not populated" >&2; exit 1; }
CA=$(kubectl -n "$NS" get secret "$SA-token" -o jsonpath='{.data.ca\.crt}')

OUT=$(mktemp)
chmod 600 "$OUT"
trap 'rm -f "$OUT"' EXIT
cat > "$OUT" <<KUBECONFIG
apiVersion: v1
kind: Config
clusters:
  - name: claudio
    cluster:
      server: $SERVER
      certificate-authority-data: $CA
users:
  - name: $SA
    user:
      token: $TOKEN
contexts:
  - name: claudio
    context:
      cluster: claudio
      user: $SA
      namespace: $NS
current-context: claudio
KUBECONFIG
unset TOKEN CA

echo "== Verifying with the new kubeconfig =="
export KUBECONFIG="$OUT"
if ! kubectl -n "$NS" get deployments >/dev/null 2>&1; then
	echo "   cluster CA does not match the external endpoint – falling back to insecure-skip-tls-verify" >&2
	kubectl config set-cluster claudio --insecure-skip-tls-verify=true >/dev/null
	kubectl config unset clusters.claudio.certificate-authority-data >/dev/null
	kubectl -n "$NS" get deployments >/dev/null
fi
for check in "patch deployments" "patch services" "patch configmaps" "patch ingresses.networking.k8s.io" "get pods" "get pods/log"; do
	# shellcheck disable=SC2086
	printf '   can %-36s %s\n' "$check" "$(kubectl -n "$NS" auth can-i $check)"
done
printf '   can %-36s %s (must be no)\n' "get secrets" "$(kubectl -n "$NS" auth can-i get secrets || true)"
printf '   can %-36s %s (must be no)\n' "patch namespaces" "$(kubectl auth can-i patch namespaces || true)"
unset KUBECONFIG

if [ "${SET_GH_SECRET:-1}" = 1 ] && command -v gh >/dev/null; then
	echo "== Storing repository secret KUBECONFIG_B64 in $REPO =="
	base64 <"$OUT" | tr -d '\n' | gh secret set KUBECONFIG_B64 --repo "$REPO"
	echo "done – the next push to main deploys via GitHub Actions"
else
	echo "== gh not used – store the secret yourself (the file is deleted when this script exits) =="
	echo "   base64 < KUBECONFIG_FILE | tr -d '\\n' | gh secret set KUBECONFIG_B64 --repo $REPO"
	read -rp "Press enter to delete $OUT ..." _
fi
