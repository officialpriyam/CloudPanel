# Security Policy

CloudPanel changes should include a dependency audit and strict-mode validation before release:

```bash
npm audit --omit=dev
npm run typecheck
npm run lint
npm test
npm run build
```

Secrets must be stored through encrypted configuration fields or environment variables. Proxmox tokens, payment gateway credentials, SFTP passwords/private keys, webhook secrets, and integration API keys must not be logged or returned by API responses.

Operational security defaults:

- Enforce RBAC on all admin routes.
- Prefer TOTP and email verification for production.
- Enable KYC gating before VM creation when fraud risk is material.
- Keep app-level IP/user rate limits enabled.
- Use Cloudflare or an equivalent edge provider for volumetric DDoS protection.
