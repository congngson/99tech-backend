# Production Improvements — Live Scoreboard

## Current Demo vs Production

| Concern | Demo (in-memory) | Production |
|---------|-----------------|------------|
| Score store | `Map` in Node.js process | Postgres + Redis |
| Leaderboard | Computed on every read | Redis `ZADD`/`ZREVRANGE` sorted set |
| SSE fan-out | In-process `Set<callback>` | Redis pub/sub → N API nodes |
| Auth | JWT only | JWT + refresh token + revocation list |
| Idempotency | In-memory `Map` | Redis key with TTL |
| Rate limiting | In-memory sliding window | Redis + Lua atomic counter |

## Scaling Architecture

```
                        Internet
                            │
                      [Load Balancer]
                     sticky SSE sessions
                            │
              ┌─────────────┼─────────────┐
        [API Node 1]  [API Node 2]  [API Node 3]
              │             │             │
              └──────── [Redis] ──────────┘
                     pub/sub + cache
                            │
                      [Postgres]
                    primary + replicas
                    (score_events, user_scores)
```

### Why Redis sorted sets for leaderboard?

`ZADD user_scores <score> <userId>` → O(log N) insert
`ZREVRANGE user_scores 0 9 WITHSCORES` → O(log N + k) read

No need to sort the full table on every leaderboard request.

## Additional Features

### Seasonal / Time-Boxed Leaderboards
- Partition `score_events` by season ID.
- Maintain a separate Redis sorted set per season.
- Scores reset automatically at season boundary.

### Action Validation Hooks
- Pluggable `ActionVerifier` interface — different actions can have different proof strategies (e.g. GPS coordinate for location-based actions, video hash for gameplay recordings).
- Server fetches proof from an authoritative source and rejects if it doesn't match.

### Webhook Notifications
- When a user enters the top 10, fire a webhook to downstream services (push notification, email).
- Implemented as an async worker consuming a queue (BullMQ / SQS).

### Analytics Pipeline
- Stream `score_events` to Kafka → ClickHouse for real-time dashboards.
- Detect anomalies (sudden 10× spike in a user's score) and flag for manual review.

### Caching Strategy
- Leaderboard cached in Redis with 1 s TTL.
- Cache is write-through: invalidated immediately on every accepted `score_events` write.
- `GET /leaderboard` p95 < 5 ms with cache hit.

## Capacity Planning

### Targets (per API node)
| Metric | Target |
|--------|--------|
| SSE connections | 10 000 concurrent |
| Score updates | 500 req/s |
| Leaderboard reads | 2 000 req/s (Redis cache hit) |
| p95 latency — score update | ≤ 200 ms |
| p95 latency — leaderboard | ≤ 20 ms (cache hit) / ≤ 100 ms (miss) |

### Sizing (single region, 10 K users, 50 K SSE clients)
| Component | Spec | Notes |
|-----------|------|-------|
| API nodes | 4 × 2 vCPU / 4 GB | Node.js I/O-bound; scale horizontally |
| Redis | 1 primary + 1 replica, r6g.large | Pub/sub + leaderboard sorted set + idempotency keys |
| Postgres | 1 primary + 2 read replicas, db.r6g.xlarge | score_events partitioned by month |
| Load balancer | AWS ALB | Sticky sessions for SSE (IP-hash) |

### score_events Sharding Strategy
- **Partition by month** (Postgres declarative partitioning): `PARTITION BY RANGE (created_at)`
  - Keeps hot partition small (current month only)
  - Old partitions can be archived to S3 as Parquet for analytics
- **Shard by user_id hash** when a single partition exceeds 100 M rows:
  - 4 shards: `user_id % 4` routes to `score_events_shard_{0..3}`
  - Application-layer routing — no cross-shard joins needed (leaderboard reads from Redis)

### Horizontal Scaling Triggers
| Signal | Threshold | Action |
|--------|-----------|--------|
| CPU sustained > 70 % | 5 min | Add 1 API node (ASG) |
| SSE connections > 8 000/node | — | Add 1 API node |
| Redis memory > 60 % | — | Upgrade instance or enable cluster mode |
| Postgres replication lag > 500 ms | — | Add read replica |

---

## Geo-Distribution

### Multi-Region Architecture
```
                   ┌─────────────────────────────────────────┐
                   │          Global Load Balancer            │
                   │   (AWS Route 53 latency-based routing)  │
                   └────────────┬──────────────┬─────────────┘
                                │              │
               ┌────────────────┐              └────────────────┐
               │  Region: US-EAST-1             Region: AP-SOUTHEAST-1
               │  API × 3 nodes                 API × 2 nodes
               │  Redis primary                 Redis replica (read-only)
               │  Postgres primary              Postgres read replica
               └────────────────────────────────────────────────┘
```

### Leaderboard Consistency Model
- **Global leaderboard**: single source of truth in the primary region; replicated to other regions with eventual consistency (≤ 500 ms lag acceptable for leaderboard reads).
- **Score writes**: always routed to primary region to avoid write conflicts.
- **SSE fan-out**: each region subscribes to the primary Redis pub/sub channel; region-local API nodes push to their SSE clients.

### CDN for Static Assets
- Swagger UI / static files served via CloudFront (or Cloudflare).
- `/api/*` endpoints bypass CDN (no caching on authenticated routes).
- SSE endpoint (`/stream`) is always proxied directly to origin — CDN cannot buffer it.

### Failover
- **Active-passive**: US-EAST-1 primary, AP-SOUTHEAST-1 standby. Route 53 health check flips DNS in < 60 s.
- **RTO**: 60 s (DNS propagation) + 30 s (warm-up) = ≤ 90 s total.
- **RPO**: Postgres synchronous replication to standby → 0 data loss for committed transactions.

---

## Observability

| Signal | Tool | Alert |
|--------|------|-------|
| API latency p95 | Prometheus + Grafana | > 200 ms for 5 min |
| Score event rejection rate | Prometheus counter | > 5% in 1 min |
| SSE connection count | Gauge | > 8 000 per node |
| Redis pub/sub lag | Redis INFO | > 500 ms |
| DB replication lag | Postgres `pg_stat_replication` | > 1 s |
