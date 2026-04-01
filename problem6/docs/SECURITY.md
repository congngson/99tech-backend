# Security Design — Live Scoreboard

## Threat Model

| Threat | Impact | Mitigation |
|--------|--------|------------|
| Replay attack (resend same action) | Inflate score | `actionInstanceId` unique per user |
| Duplicate HTTP requests | Double credit | `Idempotency-Key` per user, 24 h window |
| Clock manipulation (`occurredAt` in future) | Bypass time-gated actions | ±5 min clock skew check on server |
| Stolen JWT used to submit actions | Score under victim's account | Short JWT TTL (1 h), revocation list |
| Brute-force token endpoint | Account takeover | Rate limit: 5 req/min on `/auth/*` |
| High-frequency score spam | Score inflation | Rate limit: 20 req/min on `/actions/complete` per user |
| Mass fake registrations → score spam | Leaderboard pollution | Email verification + CAPTCHA on real register |
| Horizontal enumeration of top users | Privacy leak | `userId` is opaque; only `displayName` exposed |
| SSRF / injection via actionId | RCE / data corruption | Server-side allowlist for valid `actionId` values; never eval user input |
| SQLi | Data breach | Parameterised queries only; no raw string interpolation |

## Authentication

- JWT signed with `HS256` (or `RS256` for multi-service). Secret rotated via environment variable, never committed to source.
- Access token TTL: **1 hour**.
- Refresh token TTL: **7 days**, stored in `HttpOnly` cookie, rotated on use.
- On logout, refresh token added to a Redis deny-list checked on every `/auth/refresh` call.

## Score Integrity

```
Client completes action
  → POST /actions/complete
  → Server verifies:
      1. JWT valid + not revoked
      2. actionId in server-side allowlist
      3. occurredAt within ±5 min of server clock
      4. Idempotency-Key not seen for this user in past 24 h
      5. actionInstanceId not seen for this user ever
  → Atomic DB transaction (score_events + user_scores)
  → Points defined 100% server-side — client cannot influence amount
```

The client **never sends a points value**. Points are looked up from a server-side map keyed by `actionId`. This prevents clients from sending `"awardedPoints": 99999`.

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /actions/complete` | 20 req | per user per minute |
| `GET /leaderboard` | 60 req | per IP per minute |
| `GET /stream` | 5 concurrent | per user |
| `POST /auth/*` | 5 req | per IP per minute |

Enforced via Redis sliding-window counters (distributed, survives node restart).

## Transport Security

- TLS 1.2+ enforced on load balancer / Nginx.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` headers on all responses.

## Audit Logging

Every `score_events` row is an immutable audit record:
- Who (`user_id`)
- What (`action_id`, `action_instance_id`, `awarded_points`)
- When (`created_at`)
- Outcome (`status`, `rejection_reason`)

Logs are streamed to an append-only SIEM (e.g. CloudWatch Logs) and retained for 90 days.
