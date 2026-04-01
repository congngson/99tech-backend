# Backend-NodeJS — 99Tech Code Challenges

Solutions to [99Tech Code Challenge](https://github.com/99techteam/code-challenge) problems 4, 5, and 6.
Each problem is a self-contained directory with its own `package.json`, Dockerfile, tests, and README.

---

## Live Demo

| Service | URL |
|---------|-----|
| Showcase (portfolio) | https://showcase-99tech.fly.dev |
| Problem 4 — Sum to N | https://p4-sum-to-n.fly.dev |
| Problem 5 — CRUD API | https://p5-crud-api.fly.dev |
| Problem 5 — Swagger UI | https://p5-crud-api.fly.dev/docs/ |

Default credentials for Problem 5: `root` / `Root@123456`

---

## Problems

| # | Title | Type | Port |
|---|-------|------|------|
| [4](problem4/) | Three Ways to Sum to N | Algorithm + web demo | 3004 |
| [5](problem5/) | A Secure CRUD Server | Express API + JWT auth + frontend | 3005 |
| [6](problem6/) | Live Scoreboard | System design document | — |


---

## Problem 4 — Three Ways to Sum to N

Implements `sum_to_n(n)` using three distinct strategies. All handle positive, negative, and zero inputs.

| | Strategy | Time | Space |
|-|----------|------|-------|
| **A** | Gauss closed-form `n*(n+1)/2` | O(1) | O(1) |
| **B** | Iterative loop | O(n) | O(1) |
| **C** | `Array.from` + `reduce` | O(n) | O(n) |

→ See [problem4/README.md](problem4/README.md)

---

## Problem 5 — A Secure CRUD Server

Express + TypeScript CRUD API on SQLite, extended with a production-grade auth system and security hardening beyond the base requirements.

**Highlights:**
- Dual-token JWT — 15 min access token + 7-day refresh token (HttpOnly cookie, rotated on use)
- bcrypt cost 12 — ~250ms/hash, resists offline GPU brute-force
- RBAC — `root` manages all; `user` manages own resources only — enforced at SQL level
- Zod validation on all routes — raw input never touches the database
- Parameterized SQL only — SQL injection structurally impossible
- 18 integration tests with in-memory SQLite

→ See [problem5/README.md](problem5/README.md)

---

## Problem 6 — Live Scoreboard (System Design)

Production system design for a real-time top-10 leaderboard supporting 10K+ concurrent SSE connections.
No implementation code — design documents only.

| Document | Description |
|----------|-------------|
| [API_SPEC.md](problem6/docs/API_SPEC.md) | REST + SSE contract, request/response schemas, data models |
| [FLOW.md](problem6/docs/FLOW.md) | Sequence diagrams: score update, leaderboard fetch, SSE lifecycle |
| [SECURITY.md](problem6/docs/SECURITY.md) | Threat model, anti-cheat, rate limiting, audit logging |
| [IMPROVEMENTS.md](problem6/docs/IMPROVEMENTS.md) | Capacity planning, geo-distribution, observability |

**Key decisions:**

| Decision | Reason |
|----------|--------|
| Points server-side only | Client cannot manipulate score amount |
| `Idempotency-Key` in Redis (24 h TTL) | Prevents duplicate credits on HTTP retries |
| `actionInstanceId` unique per user | Prevents replay of the same game event |
| Atomic DB transaction | `score_events` + `user_scores` — both commit or neither |
| Redis sorted set (`ZADD`/`ZREVRANGE`) | O(log N) writes, O(log N + k) reads — no full table scan |
| SSE over WebSocket | Unidirectional, proxy-friendly, no client library needed |
| Redis pub/sub for SSE fan-out | All API nodes receive updates, decouples write path |

→ See [problem6/README.md](problem6/README.md)

---

## Repository Structure

```
Backend-NodeJS/
├── problem4/                  # Sum to N — algorithm + web demo
│   ├── Dockerfile
│   ├── index.ts               # 3 implementations
│   ├── index.test.ts          # 21 Jest unit tests
│   ├── server.ts              # HTTP demo server (port 3004)
│   └── README.md
├── problem5/                  # Secure CRUD Server
│   ├── Dockerfile
│   ├── src/
│   │   ├── config.ts          # Env config (Zod validated)
│   │   ├── db/database.ts     # SQLite + WAL + migration + root seed
│   │   ├── middleware/auth.ts # JWT verify + RBAC guard
│   │   ├── routes/
│   │   │   ├── auth.ts        # Login, refresh, logout, /me
│   │   │   ├── users.ts       # User CRUD (root only)
│   │   │   └── resources.ts   # CRUD + ownership enforcement
│   │   ├── public/index.html  # Vanilla JS SPA frontend
│   │   └── server.ts          # Express entry (helmet, cors, rate-limit)
│   ├── tests/
│   │   └── resources.test.ts  # 18 integration tests
│   ├── openapi.yaml
│   └── README.md
├── problem6/                  # Live Scoreboard — design docs only
│   ├── docs/
│   │   ├── API_SPEC.md
│   │   ├── FLOW.md
│   │   ├── SECURITY.md
│   │   └── IMPROVEMENTS.md
│   └── README.md
├── docker-compose.yml         # Orchestrates all services locally
└── .gitignore                 # showcase/ excluded — not for customer commits
```

---

## Prerequisites

- **Docker + Docker Compose** — recommended, no other setup needed
- OR **Node.js 20+** and **npm 10+** — for running problems individually
