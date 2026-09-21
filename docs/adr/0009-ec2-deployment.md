# ADR 0009 — Single EC2 backend deployed through ECR and SSM

- **Status:** Accepted
- **Date:** 2026-09-21

## Context

The backend needs persistent WebSockets and one authoritative in-memory market engine. Fly.io is not
available for this deployment. Amazon EC2 is available, but opening SSH to GitHub-hosted runners
would require a broad, changing source-IP allowance and a long-lived private key.

## Decision

Run exactly one API container on one EC2 instance. Caddy is the only public container and terminates
HTTPS/WSS before forwarding to the API on a private Docker network.

GitHub Actions authenticates to AWS with OIDC, pushes an immutable image to ECR, and invokes the host
through Systems Manager Run Command. The EC2 instance role pulls the image and reads the production
environment from one Parameter Store SecureString. Neither AWS access keys nor SSH keys are stored
in GitHub.

Deployment replaces the API container, verifies container health and public `/readyz`, and restores
the previous image and environment on failure. A short reconnect is intentional: blue/green overlap
would expose two divergent in-memory markets.

`TRUST_PROXY=true` is valid only in this topology because the API has no host port; only Caddy can
reach it. This preserves per-client IP rate limiting from Caddy's forwarded address.

## Consequences

**Good**

- No public SSH port or long-lived cloud credentials.
- Image identity is pinned by ECR digest.
- TLS certificates and runtime secrets stay outside the application image.
- Failed releases roll back without pretending two engines are one market.

**Costs, accepted**

- One EC2 instance remains a deliberate availability limit.
- Deploys disconnect sockets briefly; clients already resynchronise after reconnect.
- Initial setup requires IAM roles, ECR, SSM Agent, DNS, and a SecureString parameter.

## Related

[`../06-ops-deploy.md`](../06-ops-deploy.md),
[`0004-no-redis-nats.md`](./0004-no-redis-nats.md),
[`0007-ws-auth-ticket.md`](./0007-ws-auth-ticket.md).
