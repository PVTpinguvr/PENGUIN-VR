import { createServer } from 'node:http';
import { createPublicKey, verify as verifySignature, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { AccountStore } from './account-store.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATABASE_PATH = process.env.DATABASE_PATH || './penguin-vr.sqlite';
const AUTH_JWKS_URL = process.env.AUTH_JWKS_URL;
const AUTH_ISSUER = process.env.AUTH_ISSUER;
const AUTH_AUDIENCE = process.env.AUTH_AUDIENCE;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const GAME_SERVER_SHARED_SECRET = process.env.GAME_SERVER_SHARED_SECRET || '';
const BODY_LIMIT = 16 * 1024;
const store = new AccountStore(DATABASE_PATH);

let jwksCache = null;
let jwksLoadedAt = 0;
const requestWindows = new Map();

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(CORS_ORIGIN ? {
      'access-control-allow-origin': CORS_ORIGIN,
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
    } : {})
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error('Request body too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON body.'), { statusCode: 400 }); }
}

async function fetchJwks(force = false) {
  if (!AUTH_JWKS_URL) throw new Error('AUTH_JWKS_URL is not configured. Backend authentication is fail-closed.');
  if (!force && jwksCache && Date.now() - jwksLoadedAt < 10 * 60 * 1000) return jwksCache;
  const url = new URL(AUTH_JWKS_URL);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
    throw new Error('JWKS URL must use HTTPS outside localhost.');
  const result = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!result.ok) throw new Error(`JWKS fetch failed (${result.status}).`);
  const data = await result.json();
  if (!Array.isArray(data.keys)) throw new Error('JWKS document has no keys array.');
  jwksCache = data.keys;
  jwksLoadedAt = Date.now();
  return jwksCache;
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

async function authenticate(request) {
  if (!AUTH_ISSUER || !AUTH_AUDIENCE || !AUTH_JWKS_URL)
    throw Object.assign(new Error('Backend identity verification is not configured.'), { statusCode: 503 });
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '');
  if (!match) throw Object.assign(new Error('Bearer token required.'), { statusCode: 401 });
  const parts = match[1].split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Invalid identity token.'), { statusCode: 401 });

  let header, claims;
  try { header = decodeJwtPart(parts[0]); claims = decodeJwtPart(parts[1]); }
  catch { throw Object.assign(new Error('Invalid identity token.'), { statusCode: 401 }); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string')
    throw Object.assign(new Error('Unsupported identity token signature.'), { statusCode: 401 });

  let keys = await fetchJwks();
  let jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig'));
  if (!jwk) {
    keys = await fetchJwks(true);
    jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig'));
  }
  if (!jwk || (jwk.alg && jwk.alg !== 'RS256') || (Array.isArray(jwk.key_ops) && !jwk.key_ops.includes('verify')) ||
      Buffer.from(jwk.n || '', 'base64url').length < 256)
    throw Object.assign(new Error('Identity signing key was not recognised or is too weak.'), { statusCode: 401 });
  if (header.crit || header.b64 === false)
    throw Object.assign(new Error('Unsupported critical JWT header.'), { statusCode: 401 });

  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const valid = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'));
  const now = Math.floor(Date.now() / 1000);
  const audienceValid = Array.isArray(claims.aud) ? claims.aud.includes(AUTH_AUDIENCE) : claims.aud === AUTH_AUDIENCE;
  if (!valid || claims.iss !== AUTH_ISSUER || !audienceValid || !claims.sub ||
      typeof claims.exp !== 'number' || claims.exp <= now ||
      (typeof claims.nbf === 'number' && claims.nbf > now + 30)) {
    throw Object.assign(new Error('Identity token validation failed.'), { statusCode: 401 });
  }
  if (typeof claims.sub !== 'string' || claims.sub.length < 3 || claims.sub.length > 128)
    throw Object.assign(new Error('Identity subject is invalid.'), { statusCode: 401 });
  return { accountId: claims.sub };
}

function nowSeconds() { return Math.floor(Date.now() / 1000); }

function enforceRateLimit(accountId) {
  const now = Date.now();
  const existing = requestWindows.get(accountId);
  if (!existing || now - existing.start > 60_000) {
    requestWindows.set(accountId, { start: now, count: 1 });
    return;
  }
  existing.count += 1;
  if (existing.count > 120) throw Object.assign(new Error('Rate limit exceeded.'), { statusCode: 429 });
}

async function handle(request, response) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS_ORIGIN ? {
      'access-control-allow-origin': CORS_ORIGIN,
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
    } : {});
    response.end();
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'penguin-vr-account-api', authConfigured: !!(AUTH_JWKS_URL && AUTH_ISSUER && AUTH_AUDIENCE), dedicatedAdmissionConfigured: GAME_SERVER_SHARED_SECRET.length >= 32 });
    return;
  }

  // These two routes are server-to-server only. The server key is never distributed
  // in the Quest client. All player identity still comes from a one-time ticket issued
  // to the player's verified Unity Authentication subject.
  if (request.method === 'POST' && url.pathname === '/v1/server/admit') {
    if (GAME_SERVER_SHARED_SECRET.length < 32)
      return sendJson(response, 503, { error: 'server_admission_unconfigured', message: 'Dedicated server admission is not configured.' });
    const supplied = Buffer.from(String(request.headers['x-penguin-server-key'] || ''), 'utf8');
    const expected = Buffer.from(GAME_SERVER_SHARED_SECRET, 'utf8');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return sendJson(response, 401, { error: 'server_authentication_failed', message: 'Dedicated server authentication failed.' });
    const body = await readJson(request);
    if (typeof body.ticket !== 'string' || body.ticket.length < 32 || body.ticket.length > 128)
      return sendJson(response, 400, { error: 'invalid_ticket', message: 'A valid one-time admission ticket is required.' });
    const ticketHash = createHash('sha256').update(body.ticket, 'utf8').digest('hex');
    const result = store.redeemServerAdmissionTicket(ticketHash, body.serverId, nowSeconds());
    return sendJson(response, 200, result);
  }
  if (request.method === 'POST' && url.pathname === '/v1/server/confirm-join') {
    if (GAME_SERVER_SHARED_SECRET.length < 32)
      return sendJson(response, 503, { error: 'server_admission_unconfigured', message: 'Dedicated server admission is not configured.' });
    const supplied = Buffer.from(String(request.headers['x-penguin-server-key'] || ''), 'utf8');
    const expected = Buffer.from(GAME_SERVER_SHARED_SECRET, 'utf8');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return sendJson(response, 401, { error: 'server_authentication_failed', message: 'Dedicated server authentication failed.' });
    const body = await readJson(request);
    if (typeof body.ticketHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.ticketHash))
      return sendJson(response, 400, { error: 'invalid_ticket_hash', message: 'A SHA-256 admission ticket hash is required.' });
    const result = store.confirmServerAdmissionJoin(body.ticketHash, body.serverId, nowSeconds());
    return sendJson(response, 200, result);
  }
  if (request.method === 'POST' && url.pathname === '/v1/server/validate') {
    if (GAME_SERVER_SHARED_SECRET.length < 32)
      return sendJson(response, 503, { error: 'server_admission_unconfigured', message: 'Dedicated server admission is not configured.' });
    const supplied = Buffer.from(String(request.headers['x-penguin-server-key'] || ''), 'utf8');
    const expected = Buffer.from(GAME_SERVER_SHARED_SECRET, 'utf8');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return sendJson(response, 401, { error: 'server_authentication_failed', message: 'Dedicated server authentication failed.' });
    const body = await readJson(request);
    if (!Array.isArray(body.accountIds) || body.accountIds.length > 100 || body.accountIds.some(id => typeof id !== 'string' || id.length > 128))
      return sendJson(response, 400, { error: 'invalid_account_list', message: 'A list of at most 100 account IDs is required.' });
    const checkedAt = nowSeconds();
    const bannedAccountIds = body.accountIds.filter(accountId => store.getAccessStatus(accountId, checkedAt).banned);
    return sendJson(response, 200, { checkedAt, bannedAccountIds });
  }

  const identity = await authenticate(request);
  enforceRateLimit(identity.accountId);
  const now = Math.floor(Date.now() / 1000);

  // A banned account may only read its ban screen/status. Every other account,
  // cosmetic, social, report and game-join endpoint is fail-closed until expiry/revocation.
  const isAccessStatusRequest = request.method === 'GET' && url.pathname === '/v1/access';
  const access = store.getAccessStatus(identity.accountId, now);
  if (access.banned && !isAccessStatusRequest) {
    return sendJson(response, 403, {
      error: 'account_banned',
      message: 'This account is banned from PENGUIN VR multiplayer features.',
      ban: access.ban
    });
  }
  if (isAccessStatusRequest) return sendJson(response, 200, access);

  if (request.method === 'GET' && url.pathname === '/v1/profile/me') {
    const profile = store.getAccount(identity.accountId);
    if (!profile) return sendJson(response, 404, { error: 'profile_not_found', message: 'Profile has not been bootstrapped.' });
    return sendJson(response, 200, profile);
  }
  if (request.method === 'POST' && url.pathname === '/v1/profile/bootstrap') {
    return sendJson(response, 200, store.createOrGetAccount(identity.accountId, now));
  }
  if (request.method === 'POST' && url.pathname === '/v1/server/tickets') {
    const body = await readJson(request);
    const rawTicket = randomBytes(32).toString('hex');
    const ticketHash = createHash('sha256').update(rawTicket).digest('hex');
    const issued = store.issueServerAdmissionTicket(identity.accountId, ticketHash, body.serverId, now);
    return sendJson(response, 201, { ticket: rawTicket, expiresAt: issued.expiresAt, serverId: issued.serverId });
  }
  if (request.method === 'POST' && url.pathname === '/v1/game/join') {
    return sendJson(response, 410, {
      error: 'dedicated_server_required',
      message: 'Client-reported game joins are disabled. Owner claims are recorded only after a dedicated server confirms a successfully connected client using a redeemed one-time admission ticket.'
    });
  }
  if (request.method === 'PATCH' && url.pathname === '/v1/profile/username') {
    const body = await readJson(request);
    return sendJson(response, 200, store.changeUsername(identity.accountId, body.username, now));
  }
  if (request.method === 'GET' && url.pathname === '/v1/preferences') {
    return sendJson(response, 200, store.getPreferences(identity.accountId));
  }
  if (request.method === 'PUT' && url.pathname === '/v1/preferences') {
    const body = await readJson(request);
    return sendJson(response, 200, store.updatePreferences(identity.accountId, body, now));
  }
  if (request.method === 'POST' && url.pathname === '/v1/rewards/daily/claim') {
    return sendJson(response, 200, store.claimDailyReward(identity.accountId, now));
  }
  if (request.method === 'GET' && url.pathname === '/v1/cosmetics') {
    return sendJson(response, 200, store.listCosmetics(identity.accountId, now));
  }
  if (request.method === 'POST' && url.pathname === '/v1/cosmetics/purchase') {
    const body = await readJson(request);
    const result = store.purchaseCosmetic(identity.accountId, body.cosmeticId, now);
    return sendJson(response, result.purchased ? 201 : 200, result);
  }
  if (request.method === 'POST' && url.pathname === '/v1/cosmetics/equip') {
    const body = await readJson(request);
    return sendJson(response, 200, store.equipCosmetic(identity.accountId, body.cosmeticId, now));
  }
  const cosmeticSlot = /^\/v1\/cosmetics\/equip\/([a-z]+)$/.exec(url.pathname);
  if (request.method === 'DELETE' && cosmeticSlot) {
    return sendJson(response, 200, store.unequipCosmetic(identity.accountId, cosmeticSlot[1]));
  }
  if (request.method === 'POST' && url.pathname === '/v1/reports') {
    const body = await readJson(request);
    return sendJson(response, 201, store.createReport(identity.accountId, body, now));
  }

  // Owner moderation endpoints: authorization is always derived from the verified
  // token subject and the immutable server-side game_owner row.
  if (request.method === 'GET' && url.pathname === '/v1/owner/moderation/reports') {
    return sendJson(response, 200, store.listOwnerReports(identity.accountId, url.searchParams.get('limit')));
  }
  if (request.method === 'GET' && url.pathname === '/v1/owner/moderation/bans') {
    return sendJson(response, 200, { entries: store.listOwnerBans(identity.accountId, url.searchParams.get('limit'), now) });
  }
  if (request.method === 'GET' && url.pathname === '/v1/owner/moderation/summary') {
    const reportData = store.listOwnerReports(identity.accountId, 20);
    const bans = store.listOwnerBans(identity.accountId, 20, now);
    return sendJson(response, 200, {
      ownerAccountId: identity.accountId,
      reports: reportData.reports,
      urgentReviews: reportData.urgentReviews,
      recentBans: bans
    });
  }
  const ownerPlayerRoute = /^\/v1\/owner\/moderation\/players\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && ownerPlayerRoute) {
    return sendJson(response, 200,
      store.getOwnerPlayerDetails(identity.accountId, decodeURIComponent(ownerPlayerRoute[1]), now));
  }
  if (request.method === 'POST' && url.pathname === '/v1/owner/moderation/bans') {
    const body = await readJson(request);
    return sendJson(response, 201, store.issueBan(identity.accountId, body, now));
  }
  const ownerBanRevoke = /^\/v1\/owner\/moderation\/bans\/(\d+)\/revoke$/.exec(url.pathname);
  if (request.method === 'POST' && ownerBanRevoke) {
    const body = await readJson(request);
    return sendJson(response, 200, store.revokeBan(identity.accountId, ownerBanRevoke[1], body.note, now));
  }

  if (request.method === 'GET' && url.pathname === '/v1/leaderboard') {
    return sendJson(response, 200, { entries: store.getLeaderboard(url.searchParams.get('limit')) });
  }

  if (request.method === 'GET' && url.pathname === '/v1/social/friends') {
    return sendJson(response, 200, { entries: store.listFriends(identity.accountId, url.searchParams.get('limit')) });
  }
  if (request.method === 'GET' && url.pathname === '/v1/social/friend-requests') {
    return sendJson(response, 200, store.listFriendRequests(identity.accountId, url.searchParams.get('limit')));
  }
  if (request.method === 'POST' && url.pathname === '/v1/social/friend-requests') {
    const body = await readJson(request);
    return sendJson(response, 201, store.sendFriendRequest(identity.accountId, body.targetAccountId, now));
  }
  const friendRequestAction = /^\/v1\/social\/friend-requests\/(\d+)\/(accept|decline)$/.exec(url.pathname);
  if (request.method === 'POST' && friendRequestAction) {
    const accept = friendRequestAction[2] === 'accept';
    return sendJson(response, 200,
      store.respondToFriendRequest(identity.accountId, friendRequestAction[1], accept, now));
  }
  const friendRemoval = /^\/v1\/social\/friends\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'DELETE' && friendRemoval) {
    return sendJson(response, 200, store.removeFriend(identity.accountId, decodeURIComponent(friendRemoval[1])));
  }
  if (request.method === 'GET' && url.pathname === '/v1/social/recent-players') {
    return sendJson(response, 200, { entries: store.listRecentPlayers(identity.accountId, url.searchParams.get('limit')) });
  }
  if (request.method === 'POST' && url.pathname === '/v1/social/recent-players') {
    const body = await readJson(request);
    return sendJson(response, 201,
      store.recordRecentPlayer(identity.accountId, body.targetAccountId, body.serverId, now));
  }
  sendJson(response, 404, { error: 'not_found', message: 'Endpoint not found.' });
}

const server = createServer((request, response) => {
  handle(request, response).catch(error => {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 400;
    if (status >= 500) console.error('[PENGUIN VR API]', error.message);
    sendJson(response, status, {
      error: error.code || (status >= 500 ? 'service_unavailable' : 'request_failed'),
      message: error.message,
      ...(error.ban ? { ban: error.ban } : {})
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[PENGUIN VR API] Listening on http://${HOST}:${PORT}`);
  if (!AUTH_JWKS_URL || !AUTH_ISSUER || !AUTH_AUDIENCE)
    console.warn('[PENGUIN VR API] Identity verification is NOT configured. Authenticated endpoints will fail closed.');
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
