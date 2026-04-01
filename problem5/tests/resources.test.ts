import request from 'supertest';
import Database from 'better-sqlite3';
import { app } from '../src/server';
import { setDb } from '../src/db/database';

// Use in-memory database for tests
const testDb = new Database(':memory:');
testDb.pragma('foreign_keys = ON');

// Initialize schema manually
testDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    username     TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('root', 'user')),
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at   TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS resources (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// Seed root user
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
const rootHash = bcrypt.hashSync('Root@123456', 12);
testDb.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(randomUUID(), 'root', rootHash, 'root');

// Override db before any route handlers run
setDb(testDb);

let rootToken = '';
let userId = '';
let userToken = '';

beforeAll(async () => {
  // Login as root
  const loginRes = await request(app).post('/api/auth/login').send({ username: 'root', password: 'Root@123456' });
  rootToken = loginRes.body.data.accessToken;

  // Create a regular user
  const createRes = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${rootToken}`)
    .send({ username: 'testuser', password: 'Test@123456', role: 'user' });
  userId = createRes.body.data.id;

  // Login as regular user
  const userLogin = await request(app).post('/api/auth/login').send({ username: 'testuser', password: 'Test@123456' });
  userToken = userLogin.body.data.accessToken;
});

describe('Auth', () => {
  it('returns 401 for wrong credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'root', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('returns access token on valid login', async () => {
    expect(rootToken).toBeTruthy();
  });

  it('GET /api/auth/me returns user info', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${rootToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('root');
    expect(res.body.data.role).toBe('root');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/resources');
    expect(res.status).toBe(401);
  });
});

describe('Resources (as root)', () => {
  let resourceId = '';

  it('POST /api/resources — creates resource', async () => {
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ name: 'Root Resource', description: 'created by root', status: 'active' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Root Resource');
    resourceId = res.body.data.id;
  });

  it('GET /api/resources — lists resources', async () => {
    const res = await request(app).get('/api/resources').set('Authorization', `Bearer ${rootToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it('GET /api/resources/:id — get by id', async () => {
    const res = await request(app).get(`/api/resources/${resourceId}`).set('Authorization', `Bearer ${rootToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(resourceId);
  });

  it('PATCH /api/resources/:id — update', async () => {
    const res = await request(app)
      .patch(`/api/resources/${resourceId}`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('inactive');
  });

  it('GET /api/resources — filter by status', async () => {
    const res = await request(app).get('/api/resources?status=inactive').set('Authorization', `Bearer ${rootToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.every((r: any) => r.status === 'inactive')).toBe(true);
  });

  it('DELETE /api/resources/:id — delete', async () => {
    const res = await request(app).delete(`/api/resources/${resourceId}`).set('Authorization', `Bearer ${rootToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
  });

  it('GET /api/resources/:id after delete — 404', async () => {
    const res = await request(app).get(`/api/resources/${resourceId}`).set('Authorization', `Bearer ${rootToken}`);
    expect(res.status).toBe(404);
  });
});

describe('Resources (ownership: user sees only own)', () => {
  let rootResId = '';
  let userResId = '';

  beforeAll(async () => {
    // Root creates a resource
    const r1 = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ name: 'Root Only Resource' });
    rootResId = r1.body.data.id;

    // User creates a resource
    const r2 = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'User Resource' });
    userResId = r2.body.data.id;
  });

  it('regular user cannot see root resource', async () => {
    const res = await request(app).get(`/api/resources/${rootResId}`).set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('regular user can see own resource', async () => {
    const res = await request(app).get(`/api/resources/${userResId}`).set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
  });

  it('root can see all resources', async () => {
    const res = await request(app).get('/api/resources').set('Authorization', `Bearer ${rootToken}`);
    const ids = res.body.data.items.map((r: any) => r.id);
    expect(ids).toContain(rootResId);
    expect(ids).toContain(userResId);
  });

  it('regular user list only shows own resources', async () => {
    const res = await request(app).get('/api/resources').set('Authorization', `Bearer ${userToken}`);
    const ids = res.body.data.items.map((r: any) => r.id);
    expect(ids).toContain(userResId);
    expect(ids).not.toContain(rootResId);
  });
});

describe('Users (root only)', () => {
  it('regular user cannot list users', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('root can list users', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${rootToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('root cannot delete root user', async () => {
    const usersRes = await request(app).get('/api/users').set('Authorization', `Bearer ${rootToken}`);
    const root = usersRes.body.data.find((u: any) => u.role === 'root');
    const res = await request(app).delete(`/api/users/${root.id}`).set('Authorization', `Bearer ${rootToken}`);
    expect(res.status).toBe(400);
  });
});
