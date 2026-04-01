# Problem 4 — Three Ways to Sum to N

> **99Tech Code Challenge** — Algorithm problem

Provide 3 unique implementations of `sum_to_n(n: number): number` that compute 1 + 2 + … + n using distinct algorithmic strategies. All implementations must handle positive, negative, and zero inputs correctly.

---

## Implementations

### A — Gauss Closed Form · `O(1) time · O(1) space`

Uses the mathematical identity: `sum = n * (n + 1) / 2`. No loops or memory allocation — runs in constant time regardless of n.

```typescript
export function sum_to_n_a(n: number): number {
  const abs = Math.abs(n);
  return (Math.sign(n) * abs * (abs + 1)) / 2;
}
```

**When to use:** Best performance for any n. Extended to negatives via `Math.sign(n)`.

### B — Iterative Loop · `O(n) time · O(1) space`

Classic accumulator. A for-loop adds each integer to a running sum, iterating in the correct direction for negative inputs.

```typescript
export function sum_to_n_b(n: number): number {
  let sum = 0;
  if (n >= 0) { for (let i = 1; i <= n; i++) sum += i; }
  else         { for (let i = -1; i >= n; i--) sum += i; }
  return sum;
}
```

**When to use:** Most readable; safe for any n; zero memory overhead.

### C — Functional Array · `O(n) time · O(n) space`

Declarative style: build `[1..n]` with `Array.from`, then fold with `reduce`.

```typescript
export function sum_to_n_c(n: number): number {
  if (n === 0) return 0;
  const sign = n > 0 ? 1 : -1;
  const abs = Math.abs(n);
  return sign * Array.from({ length: abs }, (_, i) => i + 1)
    .reduce((acc, v) => acc + v, 0);
}
```

**When to use:** Functional/declarative codebases; easy to compose with other array operations.

---

## Comparison

| | A — Gauss | B — Iterative | C — Functional |
|---|---|---|---|
| Time | **O(1)** | O(n) | O(n) |
| Space | **O(1)** | **O(1)** | O(n) |
| Readability | Medium | High | High |
| Risk | Overflow for huge n | None | Memory for large n |

---

## Web Demo Server

Plain Node.js HTTP server (no framework), port 3004.

| Endpoint | Description |
|----------|-------------|
| `GET /` | HTML page with live calculator |
| `GET /compute?n=<int>` | JSON — runs all 3 implementations with timing |

**Response example:**
```json
{
  "n": 10,
  "results": [
    { "name": "A — Gauss formula",  "value": 55, "description": "O(1) time · O(1) space", "time": 0.004 },
    { "name": "B — Iterative loop", "value": 55, "description": "O(n) time · O(1) space", "time": 0.013 },
    { "name": "C — Array + reduce", "value": 55, "description": "O(n) time · O(n) space", "time": 0.057 }
  ]
}
```

`time` is in **milliseconds**.

---

## Project Structure

```
problem4/
├── index.ts          # Three implementations (exported)
├── index.test.ts     # 21 Jest unit tests
├── server.ts         # Node.js HTTP server — port 3004
├── tsconfig.json
├── package.json
└── Dockerfile        # Multi-stage: tsc → node:20-alpine runtime
```

---

## Quick Start

```bash
npm install
npm run dev     # Dev server → http://localhost:3004
npm test        # 21 tests
npm run build   # Compile TypeScript → dist/
```

---

## Tests

21 test cases: 7 inputs × 3 implementations. All must return identical values.

| Input | Expected |
|-------|----------|
| 0 | 0 |
| 1 | 1 |
| 5 | 15 |
| 10 | 55 |
| 100 | 5050 |
| -1 | -1 |
| -5 | -15 |

---

## Docker

```bash
docker build -t problem4 .
docker run -p 3004:3004 problem4
# → http://localhost:3004
```

---

## Stack

- TypeScript 5, Node.js 20
- Jest + ts-jest
- Docker multi-stage build (node:20-alpine)
