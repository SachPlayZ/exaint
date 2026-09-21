# 06 — Ops and Deployment

| | |
| --- | --- |
| **Audience** | Whoever does Docker, deploy, config, or observability |
| **Read this when** | P0 scaffolding, or P12 deployment |
| **Depends on** | [`00-architecture.md §5`](./00-architecture.md#5-deployment-topology) |

---

## 1. Repository

```text
github.com/SachPlayZ/exaint      public, branch `main`
```

- Public is a deliverable, not an afterthought: a stranger must be able to clone,
  `pnpm install`, `pnpm dev`, and get a working terminal with no private access.
- **No secrets in history.** `AUTH_TICKET_SECRET` and every deploy token live in the platform's
  secret store. `.env.example` files are committed; `.env` files are not.
- Commit messages carry **no attribution footers** of any kind.
- CI runs on pull requests and on `main` (§5).

---

## 2. Topology

```text
Frontend:
Vercel

Backend:
Amazon EC2      (one persistent Docker host)
```

**Do not deploy the backend to a short-lived serverless handler.** This backend needs:

```text
persistent WebSocket connections
persistent deterministic market engine
in-memory market state
```

All three die with the handler. A container is not a preference here, it is a requirement.

Production uses:

```text
HTTPS REST
WSS WebSocket
```

---

## 3. Environment variables

**Frontend (local):**

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/v1/ws
```

**Backend (local):**

```env
PORT=8080

MARKET_SYMBOLS=BTC-USD,ETH-USD,SOL-USD,HYPE-USD,ZEC-USD
MARKET_SEED=1337

ALLOWED_ORIGINS=http://localhost:3000
TRUST_PROXY=false

AUTH_MODE=off
AUTH_TICKET_SECRET=dev-only-not-a-real-secret
AUTH_TICKET_TTL_MS=60000

ENABLE_DEBUG_CONTROLS=true
```

`AUTH_MODE=off` is **local only**. Every deployed environment runs `AUTH_MODE=ticket` with a real
`AUTH_TICKET_SECRET` from the platform's secret store — never from a committed file.

**Frontend (production):**

```env
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com/v1/ws
```

Additional backend knobs introduced during the build (record defaults here as they land):

| Var | Default | Meaning |
| --- | --- | --- |
| `MARKET_BOOK_DEPTH` | `25` | Levels per side, all symbols |
| `MARKET_TICK_MS` | `50` | Logical tick size |
| `MARKET_MAX_CATCHUP_TICKS` | `200` | Ticks one catch-up pass may run after a stall |
| `AUTH_MODE` | `ticket` | `ticket` or `off` (local dev only) |
| `AUTH_TICKET_SECRET` | — | HMAC-SHA256 key; **required** when `AUTH_MODE=ticket` |
| `AUTH_TICKET_TTL_MS` | `60000` | Connect-ticket lifetime |
| `RATE_LIMIT_GLOBAL_PER_SEC` | `20` | Per-connection global frame budget |
| `RATE_LIMIT_STRIKES` | `3` | `RATE_LIMITED` responses within 10 s before close `4429` |
| `MAX_SUBSCRIPTIONS_PER_CONN` | `5` | One per symbol |
| `MAX_FRAME_BYTES` | `8192` | Inbound frame cap |
| `HOST` | `0.0.0.0` | Listen address; `0.0.0.0` so container port mapping works |
| `TRUST_PROXY` | `false` | Trust proxy-forwarded client IPs; `true` only when the API is private behind Caddy |
| `LOG_LEVEL` | `info` | Pino level for the structured JSON log lines in §5 |

Per-tier delivery cadences (`100/200`, `500/500`, `2000/2000` ms) are constants, not env vars —
they are protocol behaviour that tests assert against, not deployment tuning.

**Frontend:**

| Var | Default | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_VISIBILITY_HARD_REFRESH_MS` | `30000` | Hidden-tab duration that forces a snapshot + history refresh |

`ENABLE_DEBUG_CONTROLS` gates `debug.tier_override`. Leave it on for the demo deployment and say so
in the README — a reviewer will want to press the buttons.

---

## 4. Docker and EC2

Multi-stage build:

```text
Node 24 LTS
non-root user
healthcheck
multi-stage build
production dependencies only
```

The production healthcheck hits `/readyz`, so Caddy is not exposed until all five market engines
have produced their first tick. `docker-compose.yml` runs api + web locally for anyone who does not
want pnpm on their machine.

Production runs [`deploy/ec2/compose.yml`](../deploy/ec2/compose.yml): the API container is private
to the Compose network and Caddy exposes ports `80` and `443`, obtains the TLS certificate, and
proxies both HTTPS and WebSocket upgrades. Keep exactly one EC2 backend instance; the market engine
is authoritative and in-memory.

### First-time EC2 setup

Use an Ubuntu LTS **x86_64/amd64** instance with an Elastic IP (the CI image is currently built for
the GitHub runner's amd64 architecture). Point the API hostname's DNS `A` record at that IP.
The security group allows `80/tcp` and `443/tcp` publicly and no inbound SSH. Install Docker Engine
with the Compose plugin, AWS CLI, curl, and the SSM Agent. Attach an instance role with:

- `AmazonSSMManagedInstanceCore` permissions;
- ECR pull access restricted to the `exaint-api` repository (`ecr:GetAuthorizationToken` uses
  `Resource: "*"`; image/layer actions stay repository-scoped);
- `ssm:GetParameter` for `/exaint/production/api-env`;
- `kms:Decrypt` for that SecureString's KMS key.

Create the ECR repository, then store one SecureString parameter at
`/exaint/production/api-env`. Its value is the complete runtime environment:

```env
API_DOMAIN=api.example.com
PORT=8080
HOST=0.0.0.0
MARKET_SYMBOLS=BTC-USD,ETH-USD,SOL-USD,HYPE-USD,ZEC-USD
MARKET_SEED=1337
MARKET_BOOK_DEPTH=25
MARKET_TICK_MS=50
MARKET_MAX_CATCHUP_TICKS=200
ALLOWED_ORIGINS=https://terminal.example.com
TRUST_PROXY=true
AUTH_MODE=ticket
AUTH_TICKET_SECRET=<openssl-rand-hex-32>
AUTH_TICKET_TTL_MS=60000
RATE_LIMIT_GLOBAL_PER_SEC=20
RATE_LIMIT_STRIKES=3
MAX_SUBSCRIPTIONS_PER_CONN=5
MAX_FRAME_BYTES=8192
ENABLE_DEBUG_CONTROLS=true
LOG_LEVEL=info
```

Generate `AUTH_TICKET_SECRET` with `openssl rand -hex 32`. Never put the parameter value in a GitHub
secret, workflow command, log, or repository file. The EC2 instance retrieves it directly using its
instance role and writes `/etc/exaint/api.env` with mode `0600`.

The GitHub `production` environment uses OIDC to assume a narrowly scoped AWS role. Its trust policy
must restrict `sub` to `repo:SachPlayZ/exaint:environment:production`. Grant that role ECR push,
`ssm:SendCommand` to the one EC2 instance, and `ssm:GetCommandInvocation`; no access keys are stored.

The deploy workflow pushes an immutable image to ECR, uses SSM Run Command to extract that image's
versioned deployment bundle, waits for `/readyz`, then verifies the public REST endpoint and a fresh
ticketed WSS `hello` before committing the release. A failed external check invokes the host rollback;
the host also restores the previous env, Compose file, Caddyfile, and image. Caddy persists certificates
in named Docker volumes. A deploy deliberately causes a brief WebSocket reconnect: overlapping two
market engines would expose divergent in-memory markets.

The image and CI both run Node 24. The repo's `engines.node` is `>=22.12.0` rather than `>=24`
so a developer on the previous LTS can still run `pnpm dev`; nothing in the codebase depends on
a Node 24-only API.

---

## 5. Observability

### Endpoints

```http
GET /healthz
GET /readyz
GET /metrics
```

`/readyz` returns ready only once **every** symbol engine has produced its first tick — otherwise a
freshly started container accepts sockets and serves an empty book for whichever symbol lagged.

### Structured logs

JSON lines. Example:

```json
{
  "level": "info",
  "event": "tier.changed",
  "connectionId": "...",
  "from": "full",
  "to": "degraded",
  "rttMs": 178,
  "jitterMs": 42
}
```

Log every tier change, every resync-causing close, every auth rejection, and every rate-limit
strike — those are the things worth knowing about in production. Never log a ticket value; log its
`sub` and its id.

### Counters

```text
ws_connections
ws_reconnects
connections_by_tier
tier_changes
book_sequence{symbol}
trades_generated{symbol}
candle_updates_generated{symbol}
candle_updates_delivered{symbol,tier}
trade_batches_delivered{symbol,tier}
book_resyncs{symbol}
invalid_ws_messages
auth_tickets_issued
auth_failures{reason}
rate_limited_frames{frame_type}
rate_limit_closes
subscriptions_by_symbol{symbol}
```

Symbol-labelled counters are what make a five-symbol engine debuggable; a single global
`trades_generated` tells you nothing about which engine stalled.

`candle_updates_generated` vs `candle_updates_delivered` is the pair that makes adaptive delivery
visible in aggregate: generated stays flat, delivered drops as clients degrade. With tier-scaled
trade batching, `trade_batches_delivered{tier}` shows the same shape.

Measured on a live server with three connections held at three tiers on `BTC-USD` for ten seconds:

```text
candle_updates_generated{symbol="BTC-USD"}                       15
candle_updates_delivered{symbol="BTC-USD",tier="full"}           87
candle_updates_delivered{symbol="BTC-USD",tier="degraded"}       20
candle_updates_delivered{symbol="BTC-USD",tier="minimal"}         5
```

8.7 Hz / 2.0 Hz / 0.5 Hz against targets of 10 / 2 / 0.5, with byte-identical final candle values
in all three connections.

---

## 6. CI/CD

Pipelines are specified in [`05-testing.md §CI`](./05-testing.md#ci).

Deploy gating: `main` deploys only after tests, web build, and E2E pass. Configure these GitHub
`production` environment variables: `AWS_REGION`, `AWS_ROLE_ARN`, `EC2_INSTANCE_ID`,
`ECR_REPOSITORY`, `EC2_ENV_PARAMETER`, and `API_ORIGIN`. Configure `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
and `VERCEL_PROJECT_ID` as environment secrets. Missing configuration fails the deployment instead
of silently skipping it. The Vercel project Root Directory is `apps/web`; its native Git deployment
is disabled by `apps/web/vercel.json` so the gated workflow is the only production deploy path. No
manual application deploys from a laptop.

---

## 7. Scaling caveat

If you run:

```text
backend replica A
backend replica B
```

and both generate their own synthetic market:

```text
A != B
```

That is incorrect — two clients would see two different markets. So for this system:

```text
one authoritative backend market-engine instance
```

is the design, and it is completely defensible. Document the production path without building it:

```text
                    Market Engine
                         │
                         ▼
                   NATS / Redis
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
        WS Gateway   WS Gateway   WS Gateway
```

Snapshots would come from shared authoritative state.

**Do not introduce Redis/NATS into the actual solution to look sophisticated.** You would be adding
failure modes without solving a current requirement. Explaining the path is enough — and explaining
*why you did not build it* is the stronger answer. See
[`adr/0004-no-redis-nats.md`](./adr/0004-no-redis-nats.md).

---

## 8. Local developer experience

```bash
pnpm install      # root
pnpm dev          # everything
pnpm dev:api      # backend
pnpm dev:web      # frontend
pnpm test
pnpm test:e2e
```

The README requirement is a single clear backend start command. `pnpm dev:api` is it.

---

## Open questions

- Metrics format: Prometheus text exposition, or plain JSON? *(assumed: Prometheus text)*

**Resolved:** the deployed demo is protected by connect tickets plus per-connection and per-IP rate
limits ([`01-protocol.md §7–8`](./01-protocol.md#7-authentication)), so no additional basic auth is
needed.
