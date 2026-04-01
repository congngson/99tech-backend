# Problem 6 — Live Scoreboard Backend (System Design)

> **99Tech Code Challenge** — System Design

Design a backend module that handles score updates from user actions, maintains a live top-10 leaderboard, and broadcasts real-time changes to all connected clients.

This solution is presented as a **production system design document** — covering API contracts, execution flows, security threats & mitigations, and horizontal scaling strategy for 10K+ concurrent clients.

---

## Design Documents

| Document | Description |
|----------|-------------|
| [API Specification](docs/API_SPEC.md) | Full REST + SSE contract, request/response schemas, data models, NFRs |
| [Execution Flows](docs/FLOW.md) | Sequence diagrams: score update, leaderboard fetch, SSE lifecycle |
| [Security Design](docs/SECURITY.md) | Threat model, anti-cheat measures, rate limiting, audit logging |
| [Production Improvements](docs/IMPROVEMENTS.md) | Capacity planning, geo-distribution, sharding, observability |

---

## System Overview

### Architecture

```
[Browser Clients]                    [SSE Subscribers]
       │                                     ↑
       ▼                                     │
[AWS Route 53 — Latency-based DNS routing]
       │
[ALB Load Balancer — Sticky sessions for SSE]
       │
[API Node 1]   [API Node 2]   [API Node 3]   ← stateless, horizontally scalable
       │              │              │
       └──────── [Redis] ────────────┘
              pub/sub + sorted set leaderboard
              + idempotency keys (24h TTL)
                       │
              [PostgreSQL Primary]
         score_events + user_scores
         Partitioned by month, replicated
```

### Key Technology Choices

| Choice | Alternative | Reason |
|--------|------------|--------|
| Redis sorted set (ZADD/ZREVRANGE) | SQL ORDER BY | O(log N) vs O(N log N) — no full table sort per read |
| SSE over WebSocket | WebSocket | Unidirectional, proxy-friendly, no client library needed |
| Redis pub/sub for SSE fan-out | In-process callbacks | Decouples write path — works across N API nodes |
| Idempotency key in Redis (24h TTL) | DB unique constraint | Checked before DB write — avoids unnecessary load |
| Atomic DB transaction | Two separate writes | score_events + user_scores both commit or neither |
| Points server-side only | Client sends points | Eliminates score manipulation vector entirely |
| Postgres monthly partitions | Single table | Hot partition stays small; cold data archived to S3 |

---

## API Summary

### POST /api/v1/scores/actions/complete

Submit a completed user action. Server awards points atomically and pushes leaderboard update to all SSE clients.

**Request:**
```http
POST /api/v1/scores/actions/complete
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>
Content-Type: application/json

{
  "actionId": "complete-quiz",
  "actionInstanceId": "evt_01JX9V8abc",
  "occurredAt": "2026-03-30T10:15:30.000Z"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user_123",
    "awardedPoints": 5,
    "newScore": 120,
    "leaderboardChanged": true,
    "processedAt": "2026-03-30T10:15:30.120Z"
  }
}
```

### GET /api/v1/scores/leaderboard

Returns top-10 users sorted by score. Cached in Redis (1s TTL).

### GET /api/v1/scores/stream

Server-Sent Events stream. Pushes `leaderboard_updated` events to all connected clients whenever top-10 changes.

---

## Score Update Flow (12 steps)

1. Client sends `POST /actions/complete` with Bearer token + `Idempotency-Key`
2. **JWT validated**: signature, expiry, not revoked
3. `actionId` verified against **server-side allowlist** — clients cannot invent action types or point values
4. `occurredAt` within **±5 min** of server clock — prevents time manipulation
5. Redis: **Idempotency-Key** not seen in past 24h → prevents double credit on HTTP retries
6. Redis: **actionInstanceId** never seen for this user → prevents replay attacks
7. **Atomic DB transaction**: `INSERT score_events` + `UPDATE user_scores SET score += N` → COMMIT
8. Cache Idempotency-Key in Redis (24h TTL)
9. `ZREVRANGE` top-10 from Redis sorted set — **O(log N + k)**
10. `PUBLISH leaderboard_updated` to Redis pub/sub channel
11. All API nodes receive PUBLISH → **push SSE event** to their connected clients
12. Return `200 { newScore, awardedPoints }` to caller

---

## Security & Anti-Cheat

| Threat | Mitigation |
|--------|-----------|
| Score inflation (fake points) | Points looked up server-side — client sends zero amount |
| Replay attack | `actionInstanceId` unique per user, stored permanently |
| Duplicate HTTP retry | `Idempotency-Key` in Redis (24h) checked before any DB write |
| Clock manipulation | `occurredAt` rejected if outside ±5 min of server time |
| Stolen JWT | 1h access TTL + revocation list; refresh in HttpOnly cookie |
| Brute-force | 5 req/min on `/auth/*`; 20 req/min on `/actions/complete` per user |
| Mass fake accounts | Email verification + CAPTCHA on registration |

---

## Scale Numbers

| Metric | Target |
|--------|--------|
| SSE connections per node | 10,000 concurrent |
| Score updates per region | 500 req/s |
| Leaderboard p95 (Redis cache hit) | ≤ 20 ms |
| Score update p95 | ≤ 200 ms |
| RTO (DNS failover) | ≤ 90 s |
| RPO | 0 (synchronous Postgres replication) |

---

## Data Models

### user_scores

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT PK | |
| display_name | TEXT | Public display name |
| score | INTEGER ≥ 0 | Current total |
| updated_at | TIMESTAMPTZ | Last increment |

### score_events (immutable audit log)

| Column | Type | Notes |
|--------|------|-------|
| event_id | TEXT PK | |
| user_id | TEXT FK | |
| action_id | TEXT | From server-side allowlist |
| action_instance_id | TEXT | UNIQUE per user |
| idempotency_key | TEXT | UNIQUE per user + 24h TTL |
| awarded_points | INTEGER | |
| status | ENUM | `accepted` \| `rejected` |
| rejection_reason | TEXT? | |
| created_at | TIMESTAMPTZ | Immutable |

---

## Non-Functional Requirements

| Metric | Target |
|--------|--------|
| POST /actions/complete p95 | ≤ 200 ms |
| GET /leaderboard p95 | ≤ 100 ms |
| SSE publish delay after write | ≤ 1 s |
| Score consistency | Strong (atomic transaction) |
| Availability | 99.9% (multi-region active-passive) |
