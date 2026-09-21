#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "usage: deploy.sh prepare <ecr-image-uri> <ssm-env-parameter> <aws-region>" >&2
  echo "       deploy.sh commit|rollback" >&2
  exit 2
}

[[ "$EUID" -eq 0 ]] || { echo "deploy.sh must run as root" >&2; exit 1; }

action="${1:-}"
root_dir="/opt/exaint"
release_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api_env="/etc/exaint/api.env"
pending_dir="${root_dir}/pending"
lock_file="/var/lock/exaint-deploy.lock"

for command in aws curl docker flock; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing required command: $command" >&2; exit 1; }
done

exec 9>"$lock_file"
flock -n 9 || { echo "another deployment is running" >&2; exit 1; }

pending_value() { [[ -f "${pending_dir}/$1" ]] && cat "${pending_dir}/$1"; }
api_domain_from() { sed -n 's/^API_DOMAIN=//p' "$1" | tail -n 1; }

compose() {
  local directory="$1" image="$2"
  shift 2
  API_IMAGE="$image" docker compose \
    --project-name exaint \
    --file "${directory}/compose.yml" \
    --env-file "$api_env" "$@"
}

wait_for_api() {
  local status
  for ((attempt = 1; attempt <= 30; attempt += 1)); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' exaint-api 2>/dev/null || true)"
    [[ "$status" == healthy ]] && return 0
    [[ "$status" == unhealthy ]] && return 1
    sleep 2
  done
  return 1
}

wait_for_edge() {
  local env_file="$1" domain
  domain="$(api_domain_from "$env_file")"
  for ((attempt = 1; attempt <= 30; attempt += 1)); do
    if curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
      --resolve "${domain}:443:127.0.0.1" "https://${domain}/readyz" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback_pending() {
  local previous_release previous_image had_previous_env new_release new_image
  previous_release="$(pending_value previous-release)"
  previous_image="$(pending_value previous-image)"
  had_previous_env="$(pending_value had-previous-env)"
  new_release="$(pending_value new-release)"
  new_image="$(pending_value new-image)"

  set +e
  docker stop exaint-edge >/dev/null 2>&1 || true
  if [[ "$had_previous_env" == true && -f "${pending_dir}/previous.env" ]]; then
    install -d -m 0700 /etc/exaint
    install -m 0600 "${pending_dir}/previous.env" "$api_env"
  else
    rm -f "$api_env"
  fi

  if [[ -n "$previous_release" && -n "$previous_image" && -f "$api_env" ]]; then
    compose "$previous_release" "$previous_image" up --detach --no-build api
    wait_for_api
    compose "$previous_release" "$previous_image" up --detach --no-build --force-recreate edge
    wait_for_edge "$api_env"
    rollback_status=$?
  elif [[ -n "$new_release" && -n "$new_image" ]]; then
    compose "$new_release" "$new_image" down --remove-orphans
    rollback_status=$?
  else
    rollback_status=1
  fi
  set -e

  if [[ "$rollback_status" -eq 0 ]]; then
    rm -rf "$pending_dir"
    echo "rollback healthy" >&2
    return 0
  fi
  echo "rollback failed readiness checks" >&2
  return 1
}

prepare() {
  [[ $# -eq 3 ]] || usage
  local image_uri="$1" env_parameter="$2" aws_region="$3"
  local next_env compose_file api_domain previous_release previous_image

  [[ ! -e "$pending_dir" ]] || { echo "a deployment is awaiting commit or rollback" >&2; exit 1; }
  [[ "$image_uri" =~ ^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || {
    echo "invalid ECR image URI" >&2
    exit 1
  }
  compose_file="${release_dir}/compose.yml"
  [[ -f "$compose_file" && -f "${release_dir}/Caddyfile" ]] || { echo "release bundle is incomplete" >&2; exit 1; }
  docker image inspect "$image_uri" >/dev/null 2>&1 || { echo "deployment image is not present locally" >&2; exit 1; }

  install -d -m 0700 /etc/exaint
  next_env="$(mktemp /etc/exaint/api.env.next.XXXXXX)"
  cleanup_next() { rm -f "$next_env"; }
  trap cleanup_next RETURN
  aws ssm get-parameter --name "$env_parameter" --with-decryption --region "$aws_region" \
    --query 'Parameter.Value' --output text >"$next_env"
  grep -q '^AUTH_TICKET_SECRET=.' "$next_env" || { echo "AUTH_TICKET_SECRET is required" >&2; exit 1; }
  grep -q '^AUTH_MODE=ticket$' "$next_env" || { echo "AUTH_MODE=ticket is required" >&2; exit 1; }
  grep -q '^TRUST_PROXY=true$' "$next_env" || { echo "TRUST_PROXY=true is required" >&2; exit 1; }
  api_domain="$(api_domain_from "$next_env")"
  [[ "$api_domain" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "runtime environment has an invalid API_DOMAIN" >&2; exit 1; }

  previous_release="$(readlink -f "${root_dir}/current" 2>/dev/null || true)"
  previous_image="$(docker inspect --format '{{.Config.Image}}' exaint-api 2>/dev/null || true)"
  install -d -m 0700 "$pending_dir"
  printf '%s' "$release_dir" >"${pending_dir}/new-release"
  printf '%s' "$image_uri" >"${pending_dir}/new-image"
  printf '%s' "$previous_release" >"${pending_dir}/previous-release"
  printf '%s' "$previous_image" >"${pending_dir}/previous-image"
  if [[ -f "$api_env" ]]; then
    install -m 0600 "$api_env" "${pending_dir}/previous.env"
    printf true >"${pending_dir}/had-previous-env"
  else
    printf false >"${pending_dir}/had-previous-env"
  fi
  install -m 0600 "$next_env" "$api_env"

  if ! compose "$release_dir" "$image_uri" config --quiet || \
    ! docker run --rm --env "API_DOMAIN=${api_domain}" \
      --volume "${release_dir}/Caddyfile:/etc/caddy/Caddyfile:ro" \
      caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile; then
    rollback_pending || true
    exit 1
  fi

  docker stop exaint-edge >/dev/null 2>&1 || true
  if ! compose "$release_dir" "$image_uri" up --detach --no-build api || \
    ! wait_for_api || \
    ! compose "$release_dir" "$image_uri" up --detach --no-build --force-recreate edge || \
    ! wait_for_edge "$api_env"; then
    echo "deployment failed readiness checks" >&2
    docker logs --tail 100 exaint-api >&2 || true
    docker logs --tail 100 exaint-edge >&2 || true
    rollback_pending || true
    exit 1
  fi
  echo "prepared ${image_uri}; awaiting external verification"
}

commit() {
  [[ $# -eq 0 ]] || usage
  [[ -d "$pending_dir" ]] || { echo "no deployment is awaiting commit" >&2; exit 1; }
  [[ "$(pending_value new-release)" == "$release_dir" ]] || { echo "wrong release controller" >&2; exit 1; }
  local new_image
  new_image="$(pending_value new-image)"
  ln -sfn "$release_dir" "${root_dir}/current"
  rm -rf "$pending_dir"
  echo "committed ${new_image}"
}

case "$action" in
  prepare) shift; prepare "$@" ;;
  commit) shift; commit "$@" ;;
  rollback) shift; [[ $# -eq 0 ]] || usage; rollback_pending ;;
  *) usage ;;
esac
