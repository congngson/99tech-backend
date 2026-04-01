# Execution Flow — Live Scoreboard

## Score Update Flow

```
Client                 API Server           Auth          ScoreService        DB (Postgres)     Redis           SSE Clients
  │                        │                 │                 │                   │               │                  │
  │── POST /actions/complete ──────────────>│                 │                   │               │                  │
  │   Bearer <token>       │                 │                 │                   │               │                  │
  │   Idempotency-Key      │                 │                 │                   │               │                  │
  │                        │── validate JWT >│                 │                   │               │                  │
  │                        │<─ user context ─│                 │                   │               │                  │
  │                        │                 │                 │                   │               │                  │
  │                        │─── validate action, idempotency, clock skew ────────>│               │                  │
  │                        │                 │  check idem key in Redis ──────────────────────────>│                  │
  │                        │                 │  (cache hit → return original response)             │                  │
  │                        │                 │                 │                   │               │                  │
  │                        │                 │  BEGIN TRANSACTION ────────────────>│               │                  │
  │                        │                 │  INSERT score_events ──────────────>│               │                  │
  │                        │                 │  UPDATE user_scores SET score+=N ──>│               │                  │
  │                        │                 │  COMMIT ───────────────────────────>│               │                  │
  │                        │                 │<─ commit success ───────────────────│               │                  │
  │                        │                 │                 │                   │               │                  │
  │                        │                 │  cache idem key ─────────────────────────────────>│                  │
  │                        │                 │  fetch top-10 ──────────────────────────────────>│                  │
  │                        │                 │<─ leaderboard snapshot ─────────────────────────│                  │
  │                        │                 │  PUBLISH leaderboard_updated ───────────────────>│                  │
  │                        │                 │                 │                   │               │── push event ──>│
  │                        │                 │                 │                   │               │                  │
  │<─ 200 OK (newScore, awardedPoints) ──────│                 │                   │               │                  │
```

## Leaderboard Fetch Flow

```
Client            API Server              Redis                DB
  │                    │                    │                   │
  │── GET /leaderboard ─────────────────>  │                   │
  │                    │── cache lookup ──>│                   │
  │                    │<─ HIT (TTL 1s) ──│                   │
  │<── 200 top-10 ─────│                   │                   │
  │                    │   (or on MISS)    │                   │
  │                    │── SELECT top-10 ──────────────────────>│
  │                    │<─ rows ────────────────────────────────│
  │                    │── cache SET TTL 1s ─────────────────>│  │
  │<── 200 top-10 ─────│                   │                   │
```

## SSE Connection Flow

```
Client              API Server              Redis pub/sub
  │                      │                       │
  │── GET /stream ──────>│                       │
  │<── SSE headers ──────│                       │
  │<── initial top-10 ───│                       │
  │                      │── SUBSCRIBE channel ─>│
  │                      │                       │
  │         (score event occurs on another request)
  │                      │<── PUBLISH message ───│
  │<── data: {...} ───────│                       │
  │                      │                       │
  │         (client disconnects)
  │── close ────────────>│                       │
  │                      │── UNSUBSCRIBE ───────>│
```

## Key Design Decisions

1. **Atomic write** — `score_events` INSERT + `user_scores` UPDATE happen in a single DB transaction. No partial state possible.
2. **Idempotency layer** — checked in Redis *before* hitting the DB to avoid unnecessary load.
3. **SSE over WebSocket** — simpler protocol for unidirectional server→client push; no client library needed.
4. **Redis pub/sub** — decouples write path from SSE fan-out; allows multiple API nodes.
5. **Leaderboard cache** — 1 s TTL prevents leaderboard query on every SSE subscriber when scores change rapidly.
