import { describe, expect, it, beforeEach } from 'vitest';
import { hashPassword, verifyPassword } from '../src/identity/password.js';
import { InMemoryPrincipalStore } from '../src/identity/principal-store.js';
import { IdentityProvider } from '../src/identity/identity-provider.js';
import { extractToken, isPublicRoute } from '../src/identity/auth-hook.js';
import {
  NotificationRuleBook,
  combineOutcomes,
  evaluateRule,
  haversineKm,
  ipMatchesNetwork,
  locationKey,
  type NotificationRule,
} from '../src/auth-monitoring/rules.js';
import { InMemoryNotifier } from '../src/auth-monitoring/notifiers.js';
import { AuthMetrics } from '../src/auth-monitoring/metrics.js';
import { createAuthMonitoring } from '../src/auth-monitoring/login-monitor.js';
import { buildAuthRecord } from '../src/auth-monitoring/auth-record.js';
import { createApp } from '../src/server/index.js';
import type { FastifyInstance } from 'fastify';

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

function createTestApp() {
  const notifier = new InMemoryNotifier();
  const components = createApp({ notifiers: [notifier] });
  return { ...components, notifier };
}

async function loginAdmin(app: FastifyInstance, provider: IdentityProvider): Promise<string> {
  provider.registerUser({
    name: 'Admin',
    email: 'admin@test.com',
    password: 'password123',
    roles: ['admin'],
  });
  const result = provider.authenticate(
    { kind: 'password', email: 'admin@test.com', password: 'password123' },
    { ip: '127.0.0.1' },
  );
  if (!result.ok) throw new Error('admin login failed');
  return result.session.token;
}

describe('password', () => {
  it('hashPassword/verifyPassword roundtrip', () => {
    const stored = hashPassword('secret-password');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('secret-password', stored)).toBe(true);
  });

  it('rejects wrong password', () => {
    const stored = hashPassword('correct');
    expect(verifyPassword('wrong', stored)).toBe(false);
  });
});

describe('IdentityProvider', () => {
  let store: InMemoryPrincipalStore;
  let provider: IdentityProvider;

  beforeEach(() => {
    store = new InMemoryPrincipalStore();
    provider = new IdentityProvider(store);
  });

  it('registers user and logs in successfully', () => {
    provider.registerUser({
      name: 'Alice',
      email: 'alice@test.com',
      password: 'password123',
    });
    const result = provider.authenticate(
      { kind: 'password', email: 'alice@test.com', password: 'password123' },
      { ip: '127.0.0.1' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.email).toBe('alice@test.com');
      expect(result.session.token.startsWith('st_')).toBe(true);
    }
  });

  it('login failure with invalid credentials', () => {
    provider.registerUser({
      name: 'Bob',
      email: 'bob@test.com',
      password: 'password123',
    });
    const result = provider.authenticate(
      { kind: 'password', email: 'bob@test.com', password: 'wrong-password' },
      { ip: '127.0.0.1' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_credentials');
  });

  it('rejects disabled principal', () => {
    const principal = provider.registerUser({
      name: 'Disabled',
      email: 'disabled@test.com',
      password: 'password123',
    });
    provider.disablePrincipal(principal.id);
    const result = provider.authenticate(
      { kind: 'password', email: 'disabled@test.com', password: 'password123' },
      { ip: '127.0.0.1' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('principal_disabled');
  });

  it('authenticates service account via apiKey', () => {
    const { apiKey } = provider.createServiceAccount({ name: 'worker' });
    const result = provider.authenticate({ kind: 'apiKey', apiKey }, { ip: '127.0.0.1' });
    expect(result.ok).toBe(true);
  });

  it('resolveToken accepts session token and apiKey', () => {
    provider.registerUser({
      name: 'Carol',
      email: 'carol@test.com',
      password: 'password123',
    });
    const login = provider.authenticate(
      { kind: 'password', email: 'carol@test.com', password: 'password123' },
      { ip: '127.0.0.1' },
    );
    expect(login.ok).toBe(true);
    if (login.ok) {
      expect(provider.resolveToken(login.session.token)?.email).toBe('carol@test.com');
    }

    const { apiKey, principal } = provider.createServiceAccount({ name: 'bot' });
    expect(provider.resolveToken(apiKey)?.id).toBe(principal.id);
  });
});

describe('auth hook', () => {
  it('allows public routes without token', () => {
    expect(isPublicRoute('/login', ['/login', '/register', '/health'])).toBe(true);
    expect(isPublicRoute('/register', ['/login', '/register', '/health'])).toBe(true);
    expect(isPublicRoute('/health', ['/login', '/register', '/health'])).toBe(true);
  });

  it('protected route without token returns 401', async () => {
    const { app } = createTestApp();
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('protected route with valid token attaches principal', async () => {
    const { app, provider } = createTestApp();
    provider.registerUser({
      name: 'Dave',
      email: 'dave@test.com',
      password: 'password123',
    });
    const login = provider.authenticate(
      { kind: 'password', email: 'dave@test.com', password: 'password123' },
      { ip: '127.0.0.1' },
    );
    if (!login.ok) throw new Error('login failed');
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${login.session.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { principal: { email: string } };
    expect(body.principal.email).toBe('dave@test.com');
    await app.close();
  });
});

describe('GATE register -> login -> GET /me', () => {
  it('returns principal with Bearer token', async () => {
    const { app } = createTestApp();

    const registerRes = await app.inject({
      method: 'POST',
      url: '/register',
      payload: { name: 'Eve', email: 'eve@test.com', password: 'password123' },
    });
    expect(registerRes.statusCode).toBe(201);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'eve@test.com', password: 'password123' },
    });
    expect(loginRes.statusCode).toBe(200);
    const { token } = loginRes.json() as { token: string };

    const meRes = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meRes.statusCode).toBe(200);
    const me = meRes.json() as { principal: { email: string } };
    expect(me.principal.email).toBe('eve@test.com');

    await app.close();
  });
});

describe('rules', () => {
  it('haversineKm computes distance between cities', () => {
    const saoPaulo = { lat: -23.55, lon: -46.63 };
    const rio = { lat: -22.91, lon: -43.17 };
    const km = haversineKm(saoPaulo, rio);
    expect(km).toBeGreaterThan(300);
    expect(km).toBeLessThan(400);
  });

  it('ipMatchesNetwork supports exact IP and CIDR', () => {
    expect(ipMatchesNetwork('192.168.1.10', '192.168.1.10')).toBe(true);
    expect(ipMatchesNetwork('192.168.1.10', '192.168.0.0/16')).toBe(true);
    expect(ipMatchesNetwork('10.5.0.1', '10.0.0.0/8')).toBe(true);
    expect(ipMatchesNetwork('8.8.8.8', '10.0.0.0/8')).toBe(false);
  });

  it('locationKey uses geo rounding or ip fallback', () => {
    const withGeo = buildAuthRecord({
      userId: 'u@test.com',
      success: true,
      ip: '8.8.8.8',
      location: { lat: 1.23456, lon: 5.6789 },
    });
    expect(locationKey(withGeo)).toBe('geo:1.23,5.68');

    const ipOnly = buildAuthRecord({ userId: 'u@test.com', success: true, ip: '203.0.113.1' });
    expect(locationKey(ipOnly)).toBe('ip:203.0.113.1');
  });

  it('evaluateRule detects latency-based impossible travel', () => {
    const rule: NotificationRule = {
      id: 'r-latency',
      type: 'latency-based',
      name: 'impossible-travel',
      enabled: true,
      params: { maxSpeedKmh: 900 },
    };
    const previousAttempt = buildAuthRecord({
      userId: 'traveler@test.com',
      success: true,
      ip: '8.8.8.8',
      location: { lat: 40.7128, lon: -74.006 },
      timestamp: '2026-01-01T10:00:00.000Z',
    });
    const attempt = buildAuthRecord({
      userId: 'traveler@test.com',
      success: true,
      ip: '8.8.8.8',
      location: { lat: 35.6762, lon: 139.6503 },
      timestamp: '2026-01-01T10:30:00.000Z',
    });
    const outcome = evaluateRule(rule, {
      attempt,
      previousAttempt,
      notifications: [],
      now: new Date('2026-01-01T10:30:00.000Z'),
    });
    expect(outcome.triggered).toBe(true);
    expect(outcome.detail).toContain('viagem impossivel');
  });

  it('combineOutcomes ANY vs ALL', () => {
    const triggered = {
      ruleId: '1',
      ruleName: 'loc',
      type: 'location-based' as const,
      triggered: true,
      suppress: false,
      additionalRecipients: [],
      detail: 'far',
    };
    const notTriggered = {
      ruleId: '2',
      ruleName: 'lat',
      type: 'latency-based' as const,
      triggered: false,
      suppress: false,
      additionalRecipients: [],
      detail: 'ok',
    };

    expect(combineOutcomes([triggered, notTriggered], 'ANY').notify).toBe(true);
    expect(combineOutcomes([triggered, notTriggered], 'ALL').notify).toBe(false);
    expect(combineOutcomes([triggered, triggered], 'ALL').notify).toBe(true);
  });
});

describe('NotificationRuleBook CRUD', () => {
  it('adds, lists, enables/disables and removes rules', () => {
    const book = new NotificationRuleBook();
    expect(book.list()).toHaveLength(0);

    const rule = book.addRule({
      type: 'user-whitelist',
      name: 'test-whitelist',
      enabled: true,
      params: { userIds: ['a@test.com'] },
    });
    expect(book.list()).toHaveLength(1);
    expect(book.list()[0]?.id).toBe(rule.id);

    const disabled = book.setEnabled(rule.id, false);
    expect(disabled?.enabled).toBe(false);

    const reenabled = book.setEnabled(rule.id, true);
    expect(reenabled?.enabled).toBe(true);

    expect(book.removeRule(rule.id)).toBe(true);
    expect(book.list()).toHaveLength(0);
    expect(book.removeRule('missing')).toBe(false);
  });
});

describe('createAuthMonitoring notifications', () => {
  it('login from far location triggers InMemoryNotifier', async () => {
    const store = new InMemoryPrincipalStore();
    let nowMs = Date.parse('2026-01-01T10:00:00.000Z');
    const now = () => new Date(nowMs);
    const provider = new IdentityProvider(store, { now });
    const notifier = new InMemoryNotifier();

    createAuthMonitoring({
      store,
      provider,
      notifiers: [notifier],
      now,
      mode: 'ANY',
      rules: [
        { type: 'location-based', name: 'location-change', enabled: true, params: { thresholdKm: 100 } },
        { type: 'latency-based', name: 'impossible-travel', enabled: true, params: { maxSpeedKmh: 900 } },
      ],
    });

    provider.registerUser({
      name: 'Traveler',
      email: 'traveler@test.com',
      password: 'password123',
    });

    provider.authenticate(
      { kind: 'password', email: 'traveler@test.com', password: 'password123' },
      { ip: '8.8.8.8', location: { lat: 40.7128, lon: -74.006 } },
    );

    nowMs = Date.parse('2026-01-01T10:30:00.000Z');
    provider.authenticate(
      { kind: 'password', email: 'traveler@test.com', password: 'password123' },
      { ip: '8.8.8.8', location: { lat: 35.6762, lon: 139.6503 } },
    );

    await flushAsync();
    expect(notifier.sent.length).toBeGreaterThan(0);
    expect(notifier.sent[0]?.subject).toContain('traveler@test.com');
  });
});

describe('confirmAttempt and reportBreach', () => {
  it('confirms attempt and reports breach with optional disablePrincipal', async () => {
    const store = new InMemoryPrincipalStore();
    let nowMs = Date.parse('2026-01-01T10:00:00.000Z');
    const now = () => new Date(nowMs);
    const provider = new IdentityProvider(store, { now });
    const notifier = new InMemoryNotifier();
    const monitoring = createAuthMonitoring({
      store,
      provider,
      notifiers: [notifier],
      now,
      mode: 'ANY',
      rules: [
        { type: 'location-based', name: 'location-change', enabled: true, params: { thresholdKm: 50 } },
      ],
    });

    provider.registerUser({
      name: 'Frank',
      email: 'frank@test.com',
      password: 'password123',
    });

    provider.authenticate(
      { kind: 'password', email: 'frank@test.com', password: 'password123' },
      { ip: '8.8.8.8', location: { lat: 48.8566, lon: 2.3522 } },
    );
    nowMs = Date.parse('2026-01-01T12:00:00.000Z');
    const second = provider.authenticate(
      { kind: 'password', email: 'frank@test.com', password: 'password123' },
      { ip: '8.8.8.8', location: { lat: -33.8688, lon: 151.2093 } },
    );
    await flushAsync();

    expect(notifier.sent.length).toBeGreaterThan(0);
    const attemptId = second.ok ? second.attempt.attemptId : '';
    expect(attemptId.length).toBeGreaterThan(0);

    const confirmed = monitoring.engine.confirmAttempt(attemptId);
    expect(confirmed.length).toBeGreaterThan(0);
    expect(confirmed[0]?.response).toBe('confirmed');

    nowMs = Date.parse('2026-01-01T14:00:00.000Z');
    const third = provider.authenticate(
      { kind: 'password', email: 'frank@test.com', password: 'password123' },
      { ip: '8.8.8.8', location: { lat: 51.5074, lon: -0.1278 } },
    );
    await flushAsync();
    const breachAttemptId = third.ok ? third.attempt.attemptId : '';

    const breach = monitoring.engine.reportBreach(breachAttemptId, { disablePrincipal: true });
    expect(breach.breachMarked).toBe(true);
    expect(breach.principalDisabled).toBe(true);

    const afterDisable = provider.authenticate(
      { kind: 'password', email: 'frank@test.com', password: 'password123' },
      { ip: '127.0.0.1' },
    );
    expect(afterDisable.ok).toBe(false);
  });
});

describe('AuthMetrics', () => {
  it('snapshot aggregates totals by user and ip', () => {
    const metrics = new AuthMetrics();
    metrics.recordAttempt(
      buildAuthRecord({ userId: 'u@test.com', success: true, ip: '203.0.113.1' }),
    );
    metrics.recordAttempt(
      buildAuthRecord({ userId: 'u@test.com', success: false, ip: '203.0.113.1' }),
    );
    metrics.recordNotification('u@test.com', '203.0.113.1');
    metrics.recordBreach('u@test.com', '203.0.113.1');

    const snap = metrics.snapshot();
    expect(snap.totals.attempts).toBe(2);
    expect(snap.totals.failures).toBe(1);
    expect(snap.totals.notifications).toBe(1);
    expect(snap.totals.breaches).toBe(1);
    expect(snap.byUser['u@test.com']?.attempts).toBe(2);
    expect(snap.byIp['203.0.113.1']?.failures).toBe(1);
  });
});

describe('HTTP API', () => {
  it('register, login, me and auth-metrics as admin', async () => {
    const { app, provider } = createTestApp();
    const adminToken = await loginAdmin(app, provider);

    const registerRes = await app.inject({
      method: 'POST',
      url: '/register',
      payload: { name: 'Grace', email: 'grace@test.com', password: 'password123' },
    });
    expect(registerRes.statusCode).toBe(201);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'grace@test.com', password: 'password123', location: { lat: -23.55, lon: -46.63 } },
    });
    expect(loginRes.statusCode).toBe(200);
    const { token } = loginRes.json() as { token: string };

    const meRes = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meRes.statusCode).toBe(200);

    const metricsRes = await app.inject({
      method: 'GET',
      url: '/auth-metrics',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(metricsRes.statusCode).toBe(200);
    const metrics = metricsRes.json() as { totals: { attempts: number } };
    expect(metrics.totals.attempts).toBeGreaterThan(0);

    await app.close();
  });
});

describe('extractToken', () => {
  it('reads Bearer and X-API-Key headers', () => {
    const bearerReq = {
      headers: { authorization: 'Bearer abc123' },
    } as Parameters<typeof extractToken>[0];
    expect(extractToken(bearerReq)).toBe('abc123');

    const apiKeyReq = {
      headers: { 'x-api-key': 'pk_test_key' },
    } as unknown as Parameters<typeof extractToken>[0];
    expect(extractToken(apiKeyReq)).toBe('pk_test_key');
  });
});
