# CloudPanel

CloudPanel is a production-oriented virtualization and cloud hosting control panel. It provides a Next.js frontend, Fastify API, PostgreSQL/Prisma persistence, Redis/BullMQ workers, Proxmox VE automation, billing, support, KYC, deployment projects, firewall controls, and hosting billing integrations.

The project is a monorepo:

- `frontend` - Next.js app for client and admin UI.
- `backend` - Fastify API, Prisma schema, workers, billing, Proxmox, auth, and integrations.
- `whmcs-module` - WHMCS provisioning module.
- `paymenter-module` - Paymenter integration helper.
- `infra` - reverse proxy and deployment support.

## Features

- JWT auth with refresh tokens, API keys, RBAC, TOTP 2FA, OAuth/OIDC entrypoints.
- Admin-controlled registration, email verification, forced 2FA, and support mode.
- Proxmox VE nodes, VM creation, lifecycle actions, noVNC proxy, stats polling, and VM firewall rules.
- Credit wallet, hourly billing worker, Stripe/Razorpay/PayPal webhook handling, invoices, promos, and refunds foundation.
- Plans with CPU/RAM/disk limits, max VM ownership limits, and upgrade flow.
- KYC submission and admin review.
- Tickets and knowledge base, with optional external support portal link.
- Deployment projects with Git/manual/SFTP targets and BullMQ deployment jobs.
- Admin panel for users, bans/activation, nodes, payment gateways, plans, KYC, settings, tickets, audit logs.
- WHMCS and Paymenter integration endpoints.
- Docker Compose stack for PostgreSQL, Redis, MinIO, backend, worker, frontend, and optional Caddy.

## Requirements

Supported server OS:

- Ubuntu 22.04/24.04
- Debian 12

Required runtime:

- Node.js 20+
- Docker Engine with Compose plugin
- Git, curl, OpenSSL

The installer can install Node.js and Docker on Ubuntu/Debian.

## One-Command Install


```bash
curl -fsSL https://raw.githubusercontent.com/officialpriyam/cloudpanel/main/install.sh | sudo bash -s -- \
  --repo https://github.com/YOUR_ORG/cloudpanel.git \
  --dir /opt/cloudpanel
```

For a non-interactive install using generated defaults:

```bash
curl -fsSL https://raw.githubusercontent.com/officialpriyam/cloudpanel/main/install.sh | sudo bash -s -- \
  --repo https://github.com/YOUR_ORG/cloudpanel.git \
  --dir /opt/cloudpanel \
  --yes
```

The installer prompts for:

- Public frontend URL
- Public backend URL
- PostgreSQL database name, user, and password
- MinIO password
- First owner admin email, name, and password

It then:

- Installs OS dependencies, Node.js, Docker, and Docker Compose plugin.
- Clones the repository if needed.
- Writes a secure `.env`.
- Installs npm dependencies.
- Starts PostgreSQL, Redis, and MinIO.
- Pushes the Prisma schema.
- Seeds default plans/templates.
- Creates the first owner admin user.
- Builds and starts all Docker services.

## Install From a Local Checkout

```bash
git clone https://github.com/officialpriyam/cloudpanel.git
cd cloudpanel
sudo bash install.sh
```

If Docker and Node are already installed:

```bash
sudo bash install.sh --skip-docker-install
```

## Manual Development Setup

Copy and edit the environment file:

```bash
cp .env.example .env
```

Install dependencies:

```bash
npm install
```

Start database services:

```bash
docker compose up -d postgres redis minio
```

Generate Prisma and apply the schema:

```bash
npm run prisma:generate
DATABASE_URL="postgresql://cloudpanel:change-me-db-password@localhost:5432/cloudpanel?schema=public" npm run prisma:push -w backend
npm run seed -w backend
```

Create the owner admin:

```bash
DATABASE_URL="postgresql://cloudpanel:change-me-db-password@localhost:5432/cloudpanel?schema=public" \
ADMIN_EMAIL="admin@example.com" \
ADMIN_NAME="CloudPanel Owner" \
ADMIN_PASSWORD="change-this-password" \
npm run admin:create -w backend
```

Run the apps:

```bash
npm run dev
npm run dev:worker
```

Default local URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`
- API docs: `http://localhost:3000/api-docs`
- MinIO console: `http://localhost:9001`

## Docker

Start everything:

```bash
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f backend
docker compose logs -f worker
docker compose logs -f frontend
```

Stop services:

```bash
docker compose down
```

Reset local volumes:

```bash
docker compose down -v
```

The Compose stack reads `.env` for database credentials, public URLs, ports, secrets, payment gateway keys, OAuth keys, SMTP, Proxmox-related integrations, and S3/MinIO settings.

## Environment

Important variables:

- `DATABASE_URL` - container-side PostgreSQL URL, normally using host `postgres`.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` - database container credentials.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` - JWT signing secrets.
- `ENCRYPTION_KEY` - 64-character hex key for encrypted secrets.
- `API_KEY_PEPPER` - pepper for API key hashing.
- `FRONTEND_URL`, `BACKEND_PUBLIC_URL`, `NEXT_PUBLIC_API_URL` - public URLs.
- `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_SECRET`, `PAYPAL_CLIENT_SECRET` - payment credentials.
- `WHMCS_API_KEY`, `PAYMENTER_API_KEY` - integration shared secrets.

Never commit `.env`. Commit `.env.example` only.

## Admin Setup

The installer creates the first owner account. To create or reset it later:

```bash
set -a
. ./.env
set +a

DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public" \
ADMIN_EMAIL="admin@example.com" \
ADMIN_NAME="CloudPanel Owner" \
ADMIN_PASSWORD="new-secure-password" \
npm run admin:create -w backend
```

Admin capabilities include:

- Activate, suspend, or ban users.
- Edit roles and resource limits.
- Configure payment gateways.
- Configure Proxmox nodes.
- Configure support mode, KYC requirement, forced 2FA, and email verification.
- Review KYC.
- Manage plans and VM limits.
- View audit logs, tickets, revenue, VMs, and node health.

## Proxmox Setup

Create a Proxmox API token with appropriate VM and node permissions. Add the node from the CloudPanel admin page:

- Node name must match the Proxmox node name.
- Host should be reachable from the backend container.
- Port defaults to `8006`.
- Token ID and token secret are encrypted before storage.

VM firewall rules use Proxmox VM firewall APIs. CloudPanel stores a local copy and attempts to write rules to Proxmox immediately.

## WHMCS

Copy `whmcs-module/cloudpanel.php` into your WHMCS provisioning modules directory.

Use these server settings in WHMCS:

- Server hostname: CloudPanel backend URL host.
- Server password: `WHMCS_API_KEY`.
- Product config fields: node ID, plan ID, OS template slug, IP count.

The module supports:

- CreateAccount
- TerminateAccount
- SuspendAccount
- UnsuspendAccount
- ChangePackage

## Paymenter

Use `paymenter-module/CloudPanelPaymenter.php` from your Paymenter hooks/module code.

Required configuration:

- `CLOUDPANEL_URL`
- `CLOUDPANEL_PAYMENTER_KEY`

The backend endpoint is:

```text
POST /api/v1/paymenter
```

Supported actions:

- `create`
- `terminate`
- `suspend`
- `unsuspend`
- `upgrade`
- `status`
- `credit`

## Security

Run this before pushing changes:

```bash
npm audit --omit=dev
npm run typecheck
npm run lint
npm test
npm run build
```

Security notes:

- Secrets are excluded by `.gitignore`.
- Proxmox tokens, SFTP credentials, gateway secrets, and webhook secrets should only be stored encrypted or in `.env`.
- Use Cloudflare or another edge provider for volumetric DDoS mitigation.
- Enable forced 2FA, KYC gating, and email verification in production.

As of the last validation, the project uses `next@16.2.6`. npm still reports a moderate advisory for the `postcss` copy bundled inside the latest published Next package; there is no newer Next release available to consume a patched nested dependency.

## Publishing to GitHub

Before publishing:

```bash
rm -f .env frontend-dev.log frontend-dev.err.log
npm run typecheck
npm run lint
npm test
npm run build
git status --short
```

Files that should be committed:

- Source code in `backend`, `frontend`, `whmcs-module`, `paymenter-module`, `infra`
- `package.json` and `package-lock.json`
- `.env.example`
- `.gitignore`
- `docker-compose.yml`
- `install.sh`
- `README.md`
- `SECURITY.md`

Files that should not be committed:

- `.env`
- `node_modules`
- `.next`
- logs
- local data volumes

## Troubleshooting

Check service status:

```bash
docker compose ps
```

Check backend logs:

```bash
docker compose logs -f backend
```

Check worker logs:

```bash
docker compose logs -f worker
```

Re-run database schema push:

```bash
set -a
. ./.env
set +a
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public" npm run prisma:push -w backend
```

Rebuild after code changes:

```bash
docker compose up -d --build
```
