#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="CloudPanel"
DEFAULT_BRANCH="main"
REPO_URL="${CLOUDPANEL_REPO:-}"
INSTALL_DIR="${CLOUDPANEL_DIR:-/opt/cloudpanel}"
BRANCH="${CLOUDPANEL_BRANCH:-$DEFAULT_BRANCH}"
ASSUME_YES="false"
SKIP_DOCKER_INSTALL="false"

usage() {
  cat <<'EOF'
CloudPanel installer for Ubuntu/Debian.

Usage:
  bash install.sh [options]

Options:
  --repo URL              Git repository to clone when not running inside a checkout
  --dir PATH              Install directory when cloning, default: /opt/cloudpanel
  --branch NAME           Git branch to clone, default: main
  --yes                   Use generated/default answers for prompts
  --skip-docker-install   Do not install Docker if it is missing
  -h, --help              Show help

Examples:
  bash install.sh
  curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/cloudpanel/main/install.sh | sudo bash -s -- --repo https://github.com/YOUR_ORG/cloudpanel.git
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --yes)
      ASSUME_YES="true"
      shift
      ;;
    --skip-docker-install)
      SKIP_DOCKER_INSTALL="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

prompt() {
  local label="$1"
  local default_value="$2"
  local answer=""
  if [[ "$ASSUME_YES" == "true" || ! -r /dev/tty ]]; then
    printf '%s\n' "$default_value"
    return
  fi
  read -r -p "$label [$default_value]: " answer < /dev/tty
  printf '%s\n' "${answer:-$default_value}"
}

prompt_secret() {
  local label="$1"
  local default_value="$2"
  local answer=""
  if [[ "$ASSUME_YES" == "true" || ! -r /dev/tty ]]; then
    printf '%s\n' "$default_value"
    return
  fi
  read -r -s -p "$label [press Enter to generate/use default]: " answer < /dev/tty
  printf '\n' > /dev/tty
  printf '%s\n' "${answer:-$default_value}"
}

random_hex() {
  openssl rand -hex "$1"
}

require_ubuntu_or_debian() {
  if [[ ! -f /etc/os-release ]]; then
    echo "This installer supports Ubuntu and Debian only." >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian)
      ;;
    *)
      case "${ID_LIKE:-}" in
        *debian*)
          ;;
        *)
          echo "Unsupported OS: ${PRETTY_NAME:-unknown}. Use Ubuntu or Debian." >&2
          exit 1
          ;;
      esac
      ;;
  esac
}

install_base_packages() {
  $SUDO apt-get update
  $SUDO apt-get install -y ca-certificates curl git gnupg openssl lsb-release
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p "Number(process.versions.node.split('.')[0])")"
    if [[ "$major" -ge 20 ]]; then
      return
    fi
  fi
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi
  if [[ "$SKIP_DOCKER_INSTALL" == "true" ]]; then
    echo "Docker is missing and --skip-docker-install was used." >&2
    exit 1
  fi

  $SUDO install -m 0755 -d /etc/apt/keyrings
  $SUDO rm -f /etc/apt/keyrings/docker.gpg
  curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER:-}" != "root" ]]; then
    $SUDO usermod -aG docker "$SUDO_USER" || true
  fi
}

prepare_source() {
  if [[ -f package.json && -d backend && -d frontend ]]; then
    return
  fi

  if [[ -z "$REPO_URL" ]]; then
    echo "Not inside a CloudPanel checkout. Provide --repo when using curl | bash." >&2
    exit 1
  fi

  $SUDO mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ ! -d "$INSTALL_DIR/.git" ]]; then
    $SUDO git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    if [[ -n "${SUDO_USER:-}" && "${SUDO_USER:-}" != "root" ]]; then
      $SUDO chown -R "$SUDO_USER:$SUDO_USER" "$INSTALL_DIR"
    fi
  fi
  cd "$INSTALL_DIR"
}

compose() {
  $SUDO docker compose "$@"
}

write_env_file() {
  local domain frontend_url backend_url api_url db_name db_user db_pass minio_pass admin_email admin_name admin_pass

  domain="$(prompt "Panel domain or host" "localhost")"
  if [[ "$domain" == "localhost" || "$domain" == "127.0.0.1" ]]; then
    frontend_url="$(prompt "Frontend public URL" "http://localhost:3000")"
    backend_url="$(prompt "Backend public URL" "http://localhost:4000")"
  else
    frontend_url="$(prompt "Frontend public URL" "https://${domain}")"
    backend_url="$(prompt "Backend public URL" "https://api.${domain}")"
  fi
  api_url="$(prompt "Browser API URL" "${backend_url}/api/v1")"

  db_name="$(prompt "PostgreSQL database name" "cloudpanel")"
  db_user="$(prompt "PostgreSQL username" "cloudpanel")"
  db_pass="$(prompt_secret "PostgreSQL password" "$(random_hex 18)")"
  minio_pass="$(prompt_secret "MinIO root password" "$(random_hex 18)")"

  admin_email="$(prompt "Owner admin email" "admin@example.com")"
  admin_name="$(prompt "Owner admin name" "CloudPanel Owner")"
  admin_pass="$(prompt_secret "Owner admin password" "$(random_hex 12)")"

  cat > .env <<EOF
NODE_ENV=production

FRONTEND_PORT=3000
BACKEND_PORT=4000
FRONTEND_URL=${frontend_url}
BACKEND_PUBLIC_URL=${backend_url}
NEXT_PUBLIC_API_URL=${api_url}

POSTGRES_USER=${db_user}
POSTGRES_PASSWORD=${db_pass}
POSTGRES_DB=${db_name}
POSTGRES_PORT=5432
DATABASE_URL=postgresql://${db_user}:${db_pass}@postgres:5432/${db_name}?schema=public

REDIS_PORT=6379
REDIS_URL=redis://redis:6379
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=${minio_pass}
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001

JWT_ACCESS_SECRET=$(random_hex 48)
JWT_REFRESH_SECRET=$(random_hex 48)
ENCRYPTION_KEY=$(random_hex 32)
API_KEY_PEPPER=$(random_hex 32)

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
OIDC_ISSUER_URL=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@${domain}
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
DISCORD_WEBHOOK_URL=

S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=${minio_pass}
S3_BUCKET=cloudpanel-backups
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
PTERODACTYL_URL=
PTERODACTYL_API_KEY=
WHMCS_API_KEY=$(random_hex 24)
PAYMENTER_API_KEY=$(random_hex 24)
EOF
  chmod 600 .env

  ADMIN_EMAIL="$admin_email"
  ADMIN_NAME="$admin_name"
  ADMIN_PASSWORD="$admin_pass"
  export ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD
}

load_env_for_host() {
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  HOST_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"
  export HOST_DATABASE_URL
}

install_node_dependencies() {
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
}

wait_for_postgres() {
  local tries=60
  until compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    tries=$((tries - 1))
    if [[ "$tries" -le 0 ]]; then
      echo "PostgreSQL did not become ready in time." >&2
      exit 1
    fi
    sleep 2
  done
}

bootstrap_database() {
  compose up -d postgres redis minio
  wait_for_postgres
  DATABASE_URL="$HOST_DATABASE_URL" npm run prisma:generate
  DATABASE_URL="$HOST_DATABASE_URL" npm run prisma:push -w backend
  DATABASE_URL="$HOST_DATABASE_URL" npm run seed -w backend
  DATABASE_URL="$HOST_DATABASE_URL" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_NAME="$ADMIN_NAME" ADMIN_PASSWORD="$ADMIN_PASSWORD" npm run admin:create -w backend
}

main() {
  require_ubuntu_or_debian
  install_base_packages
  install_node
  install_docker
  prepare_source
  write_env_file
  load_env_for_host
  install_node_dependencies
  bootstrap_database
  compose up -d --build

  cat <<EOF

${APP_NAME} installation complete.

Frontend: ${FRONTEND_URL}
Backend:  ${BACKEND_PUBLIC_URL}
Admin:    ${ADMIN_EMAIL}
Password: ${ADMIN_PASSWORD}

Important:
- Save the admin password now. It is printed only by this installer.
- Edit .env to configure OAuth, SMTP, Proxmox, and payment gateways.
- If Docker was installed for a non-root user, log out and back in before running docker without sudo.

Useful commands:
  cd $(pwd)
  docker compose ps
  docker compose logs -f backend
  docker compose logs -f worker
EOF
}

main "$@"
