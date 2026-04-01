# API Specification — Live Scoreboard

Base path: `/api/v1`

---

## POST /api/v1/scores/actions/complete

Authenticated endpoint. Called when a user completes a valid action. Atomically increments score, refreshes leaderboard, and broadcasts SSE update.

### Headers

```
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>        # Required — prevents duplicate processing
Content-Type: application/json
```

### Request Body

```json
{
  "actionId": "complete-quiz",
  "actionInstanceId": "evt_01JX9V8abc",
  "occurredAt": "2026-03-30T10:15:30.000Z"
}
```

### Validation Rules

- JWT must be valid and map to exactly one user.
- `Idempotency-Key` must be unique per user within a 24 h window. Duplicate keys return the **original response** (idempotent replay safe).
- `actionInstanceId` must be unique per user — reuse returns `409`.
- `occurredAt` must be within ±5 min of server time (clock skew guard).
- `actionId` must be in the server-side allowed list mapped to a fixed points value.

### Success Response `200`

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

### Error Responses

| Status | Reason |
|--------|--------|
| 400 | Schema validation failure |
| 401 | Missing / expired token |
| 403 | User not authorised for action |
| 409 | Duplicate `actionInstanceId` |
| 422 | Invalid `actionId` or clock skew exceeded |
| 429 | Rate limit exceeded (20 req/min per user) |

---

## GET /api/v1/scores/leaderboard

Public endpoint. Returns top-N users sorted by score descending.

### Query Parameters

| Param | Default | Max | Description |
|-------|---------|-----|-------------|
| `limit` | 10 | 100 | Number of entries to return |

### Response `200`

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-03-30T10:15:30.120Z",
    "entries": [
      { "rank": 1, "userId": "user_1", "displayName": "Alice", "score": 980 },
      { "rank": 2, "userId": "user_2", "displayName": "Bob",   "score": 870 }
    ]
  }
}
```

**Tie-break rule**: equal scores are ordered by earliest `updated_at` (first to reach the score wins).

**Caching**: Cache in Redis with TTL 1 s. Invalidate on every successful `POST /actions/complete`.

---

## GET /api/v1/scores/stream  (Server-Sent Events)

Opens a persistent SSE connection. The server pushes leaderboard snapshots whenever the top-10 changes.

### Response Stream

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event: `leaderboard_updated`**

```
data: {"type":"leaderboard_updated","generatedAt":"...","top":[...]}

```

**Heartbeat** (every 15 s):

```
: heartbeat

```

### Stream Guarantees

- Initial snapshot sent immediately on connection.
- Reconnect: client sends `Last-Event-ID` header; server replays from that cursor.
- Max fan-out: 10 000 concurrent SSE connections per node (horizontal scale with Redis pub/sub).

---

## Data Model

### `user_scores`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | TEXT PK | User identifier |
| `display_name` | TEXT | Public display name |
| `score` | INTEGER ≥ 0 | Current total |
| `updated_at` | TIMESTAMPTZ | Last increment time |

### `score_events`

| Column | Type | Notes |
|--------|------|-------|
| `event_id` | TEXT PK | Unique event ID |
| `user_id` | TEXT FK | Indexed |
| `action_id` | TEXT | Indexed |
| `action_instance_id` | TEXT | UNIQUE per user |
| `idempotency_key` | TEXT | UNIQUE per user + 24 h TTL |
| `awarded_points` | INTEGER | Points granted |
| `status` | ENUM | `accepted` \| `rejected` |
| `rejection_reason` | TEXT? | Why rejected |
| `created_at` | TIMESTAMPTZ | |

---

## Non-Functional Requirements

| Metric | Target |
|--------|--------|
| `POST /actions/complete` p95 | ≤ 200 ms |
| `GET /leaderboard` p95 | ≤ 100 ms |
| SSE publish delay after write | ≤ 1 s |
| Score update consistency | Strong (single atomic write) |
| API tier | Stateless, horizontally scalable |
