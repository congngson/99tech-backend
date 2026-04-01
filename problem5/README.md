# Problem 5 — A Secure CRUD Server

> **99Tech Code Challenge** — Backend API

Build an ExpressJS + TypeScript CRUD server backed by SQLite. This solution extends the base requirements with a production-grade authentication system, role-based access control, and comprehensive security hardening.

---

## Features

- Full CRUD on `resources` with pagination, filtering, search, and sort
- JWT authentication (access token + refresh token rotation)
- RBAC: `root` manages all, `user` manages own resources only
- Vanilla JS frontend built into the server
- Swagger UI API docs
- 18 integration tests with in-memory SQLite

---

## Architecture

### Middleware Stack (order matters)

```
Request
  │
  ├─ Helmet          — sets security HTTP headers on every response
  ├─ CORS            — configured with credentials:true for cookie support
  ├─ cookie-parser   — parses HttpOnly cookie for refresh token
  ├─ express.json    — parse JSON body (limit 1mb)
  ├─ Rate limiter    — 200 req/min global
  ├─ /api/auth rate  — 10 req/min (brute-force protection on login)
  ├─ Routes          — auth / users / resources
  └─ Static files    — serves frontend SPA
```

### Request Lifecycle (authenticated endpoint)

```
HTTP Request
  → express.json() (parse body)
  → rateLimit (check counter in memory)
  → requireAuth middleware
      → extract Bearer token from Authorization header
      → jwt.verify(token, JWT_SECRET)
      → db.prepare('SELECT ... WHERE id = ? AND is_active = 1').get(userId)
      → attach req.user = { id, username, role }
  → Route handler
      → Zod schema validation (safeParse)
      → SQLite query (parameterized — no interpolation)
      → JSON response { success, data }
```

### Database Schema

```sql
-- Users table
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,           -- bcrypt, cost 12
  role          TEXT NOT NULL DEFAULT 'user'
                CHECK (role IN ('root', 'user')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Refresh tokens (revocation support)
CREATE TABLE refresh_tokens (
  token_hash  TEXT PRIMARY KEY,          -- SHA-256 of the token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Resources (owned by users)
CREATE TABLE resources (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'inactive', 'archived')),
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

SQLite is initialized lazily on first request via `getDb()`. The root user is seeded from environment variables on first startup. WAL mode is enabled for better concurrent read performance.

### Auth Flow

```
POST /api/auth/login
  → bcrypt.compareSync(password, hash)         — constant-time compare
  → jwt.sign({ id, username, role }, secret, { expiresIn: '15m' })  ← access token
  → jwt.sign({ id }, secret, { expiresIn: '7d' })                   ← refresh token
  → SHA-256(refreshToken) stored in refresh_tokens table
  → refresh token set as HttpOnly cookie (SameSite=Strict)
  → access token returned in JSON body

POST /api/auth/refresh
  → read refresh token from cookie
  → jwt.verify(token)
  → lookup SHA-256(token) in refresh_tokens table (must exist + not expired)
  → DELETE old token (rotation — prevents token reuse)
  → issue new access + refresh tokens
  → return new access token in JSON body

POST /api/auth/logout
  → DELETE refresh_tokens WHERE token_hash = SHA-256(cookie)
  → clearCookie('refresh_token')
```

### RBAC Model

```
root (one per system, seeded from ENV)
  ├── ✓  Read/write ALL resources
  ├── ✓  Create / update / deactivate / delete users
  └── ✗  Cannot delete itself

user (created by root)
  ├── ✓  Read/write OWN resources only (created_by = user.id)
  └── ✗  403 on /api/users
```

Ownership is enforced at the SQL query level — not just in application logic:
- **List:** `WHERE created_by = ?` for users, no filter for root
- **Get/Update/Delete:** fetch resource, check `created_by === req.user.id`

### Input Validation (Zod)

All route inputs are validated with Zod schemas before reaching business logic. Invalid input returns `400` with the Zod error message — no raw user data ever touches the database.

```typescript
const CreateSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  status:      z.enum(['active', 'inactive', 'archived']).default('active'),
});
```

### Error Handling

All endpoints return a uniform envelope:
```json
{ "success": true,  "data": { ... } }
{ "success": false, "error": "message" }
```

Unhandled errors bubble up to Express's default error handler (500). No `try/catch` swallowing is used — errors are explicit.

---

## API Endpoints

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | — | Login → access token + refresh cookie |
| POST | `/api/auth/refresh` | Cookie | Rotate refresh token |
| POST | `/api/auth/logout` | Bearer | Revoke session |
| GET | `/api/auth/me` | Bearer | Current user info |

### Users (root only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user |
| PATCH | `/api/users/:id` | Update password / role / active status |
| DELETE | `/api/users/:id` | Delete (root user protected) |

### Resources (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/resources` | List (scoped by role) — supports `status`, `q`, `page`, `limit`, `sort` |
| POST | `/api/resources` | Create (auto-owned by caller) |
| GET | `/api/resources/:id` | Get single (owner or root) |
| PATCH | `/api/resources/:id` | Partial update (owner or root) |
| DELETE | `/api/resources/:id` | Delete (owner or root) |

---

## Security

| Layer | Implementation |
|-------|---------------|
| Password hashing | bcrypt cost 12 (~250ms/hash — resists GPU brute-force) |
| Access token | JWT HS256, 15 min TTL |
| Refresh token | JWT HS256, 7 day TTL, stored hashed in DB, rotated on use |
| XSS protection | Refresh token in HttpOnly cookie — inaccessible to JavaScript |
| CSRF | SameSite=Strict cookie — blocks cross-origin form submissions |
| Brute-force | 10 req/min on `/api/auth/*` (express-rate-limit) |
| HTTP headers | Helmet: X-Frame-Options, HSTS, X-Content-Type-Options, Referrer-Policy |
| SQL injection | Parameterized queries only — `db.prepare().run(...params)` |
| Input validation | Zod schema on every route — no raw user data in queries |
| DB-verified auth | User `is_active` re-checked on every request — instant deactivation |

---

## Project Structure

```
problem5/
├── src/
│   ├── config.ts          # Env config validated with Zod
│   ├── server.ts          # Express app + middleware stack
│   ├── db/
│   │   └── database.ts    # SQLite connection, migration, root seed
│   ├── middleware/
│   │   └── auth.ts        # requireAuth + requireRole guards
│   ├── routes/
│   │   ├── auth.ts        # Login, refresh, logout, /me
│   │   ├── users.ts       # User CRUD (root only)
│   │   └── resources.ts   # Resource CRUD with ownership
│   └── public/
│       └── index.html     # Vanilla JS SPA frontend
├── tests/
│   └── resources.test.ts  # 18 integration tests (in-memory SQLite)
├── openapi.yaml           # OpenAPI 3.0 spec with JWT securitySchemes
├── tsconfig.json
├── package.json
└── Dockerfile             # Multi-stage: tsc → node:20-alpine + SQLite
```

---

## Quick Start

```bash
# Install
npm install

# Development (auto-reload)
npm run dev
# → http://localhost:3005

# Run tests (in-memory SQLite, no setup needed)
npm test

# Build for production
npm run build
npm start
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3005` | Server port |
| `JWT_SECRET` | `change-me-...` | Must be 32+ chars in production |
| `JWT_ACCESS_TTL` | `15m` | Access token expiry |
| `JWT_REFRESH_TTL` | `7d` | Refresh token expiry |
| `ROOT_USERNAME` | `root` | Root user username |
| `ROOT_PASSWORD` | `Root@123456` | Root user initial password |
| `DB_PATH` | `./data/resources.db` | SQLite file path |

Copy `.env.example` → `.env` and override for production.

---

## Accessing the App

| URL | Description |
|-----|-------------|
| `http://localhost:3005/` | Frontend SPA |
| `http://localhost:3005/docs` | Swagger UI (JWT Authorize button included) |
| `http://localhost:3005/api/auth/login` | Login endpoint |
| `http://localhost:3005/health` | Health check |

---

## Example cURL

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3005/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"root","password":"Root@123456"}' \
  | jq -r '.data.accessToken')

# 2. Create resource
curl -X POST http://localhost:3005/api/resources \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Resource","description":"hello","status":"active"}'

# 3. List resources (with filters)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3005/api/resources?status=active&q=my&page=1&limit=10&sort=desc"

# 4. Create a regular user
curl -X POST http://localhost:3005/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"Alice@123456","role":"user"}'
```

---

## Docker

```bash
docker build -t problem5 .
docker run -p 3005:3005 \
  -e JWT_SECRET=your-secret-min-32-chars-here \
  -e ROOT_PASSWORD=YourPassword123 \
  -v p5data:/app/data \
  problem5
```

---

## Tests

18 integration tests using Supertest + in-memory SQLite (injected via `setDb()`):

| Suite | Tests |
|-------|-------|
| Auth | Login success/failure, `/me`, 401 without token |
| Resources (as root) | Create, list, get, update, filter, delete, 404 after delete |
| Resources (ownership) | User can't see root resource, user sees own, root sees all |
| Users (root only) | Non-root gets 403, root lists users, root can't delete root |

```bash
npm test
# PASS tests/resources.test.ts (18 tests, ~3s)
```

---

## Stack

| Library | Version | Purpose |
|---------|---------|---------|
| express | ^4.19 | HTTP framework |
| typescript | ^5.4 | Type safety |
| better-sqlite3 | ^9.4 | SQLite driver (sync, fast) |
| zod | ^3.23 | Input validation schemas |
| jsonwebtoken | ^9.0 | JWT sign/verify |
| bcryptjs | ^2.4 | Password hashing (cost 12) |
| helmet | ^7.1 | Security HTTP headers |
| cors | ^2.8 | Cross-origin resource sharing |
| express-rate-limit | ^7.3 | Rate limiting |
| cookie-parser | ^1.4 | HttpOnly cookie parsing |
| swagger-ui-express | ^5.0 | Swagger UI for docs |
| jest + supertest | ^29 / ^7 | Integration testing |
