import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeToken(subject, privateKey, issuer, audience) {
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT', kid: 'social-api-test-key' });
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlJson({ iss: issuer, aud: audience, sub: subject, iat: now, exp: now + 300 });
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`;
}

test('authenticated HTTP routes support social relationships and owner-aware cosmetics', { timeout: 15000 }, async t => {
  const folder = mkdtempSync(join(tmpdir(), 'penguin-vr-social-api-'));
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: 'jwk' });
  const issuer = 'https://penguin-vr-social-api.test';
  const audience = 'penguin-vr-client-social-test';

  const jwksServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys: [{ ...publicJwk, kid: 'social-api-test-key', use: 'sig', alg: 'RS256' }] }));
  });
  await new Promise(resolve => jwksServer.listen(0, '127.0.0.1', resolve));

  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const apiPort = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(apiPort),
      HOST: '127.0.0.1',
      DATABASE_PATH: join(folder, 'api.sqlite'),
      AUTH_JWKS_URL: `http://127.0.0.1:${jwksServer.address().port}/jwks.json`,
      AUTH_ISSUER: issuer,
      AUTH_AUDIENCE: audience,
      GAME_SERVER_SHARED_SECRET: 'integration-test-server-secret-32-bytes-minimum'
    },
    stdio: 'ignore'
  });

  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
    jwksServer.close();
    rmSync(folder, { recursive: true, force: true });
  });

  async function waitReady() {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${apiPort}/health`);
        if (response.ok) return;
      } catch { /* The child API may still be starting. */ }
      if (child.exitCode !== null) throw new Error(`API process exited with ${child.exitCode}`);
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    throw new Error('API did not become ready.');
  }

  async function callRaw(subject, method, path, payload) {
    const response = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${makeToken(subject, privateKey, issuer, audience)}`,
        ...(payload ? { 'content-type': 'application/json' } : {})
      },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    return { status: response.status, ok: response.ok, body: await response.json() };
  }

  async function callServerRaw(method, path, payload, secret = 'integration-test-server-secret-32-bytes-minimum') {
    const response = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
      method,
      headers: {
        'x-penguin-server-key': secret,
        ...(payload ? { 'content-type': 'application/json' } : {})
      },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    return { status: response.status, ok: response.ok, body: await response.json() };
  }

  async function call(subject, method, path, payload) {
    const result = await callRaw(subject, method, path, payload);
    assert.equal(result.ok, true, `${method} ${path}: ${result.status} ${JSON.stringify(result.body)}`);
    return result.body;
  }

  await waitReady();
  const first = await call('social-player-001', 'POST', '/v1/profile/bootstrap', {});
  const second = await call('social-player-002', 'POST', '/v1/profile/bootstrap', {});
  const third = await call('social-player-003', 'POST', '/v1/profile/bootstrap', {});
  assert.equal(first.username, 'penguin0001');
  assert.equal(second.username, 'penguin0002');
  assert.equal(third.username, 'penguin0003');
  assert.equal(first.isOwner, false, 'creating a profile must not claim game ownership');
  assert.equal(second.isOwner, false, 'creating a profile must not claim game ownership');

  // Client self-reporting no longer claims owner: only the dedicated server can redeem tickets.
  const forgedClientJoin = await callRaw('social-player-001', 'POST', '/v1/game/join', { sessionId: 'fake-client-session' });
  assert.equal(forgedClientJoin.status, 410);
  assert.equal(forgedClientJoin.body.error, 'dedicated_server_required');

  // Profile two was created second but reaches a dedicated server first. A ticket is bound to
  // that specific server, consumed once, and the verified token subject—not request JSON—wins.
  const firstTicket = await call('social-player-002', 'POST', '/v1/server/tickets', { serverId: 'dedicated-eu-01' });
  assert.ok(firstTicket.ticket.length >= 32);
  const wrongServer = await callServerRaw('POST', '/v1/server/admit', {
    ticket: firstTicket.ticket, serverId: 'dedicated-us-01'
  });
  assert.equal(wrongServer.status, 401);
  const badServerKey = await callServerRaw('POST', '/v1/server/admit', {
    ticket: firstTicket.ticket, serverId: 'dedicated-eu-01'
  }, 'wrong-server-secret');
  assert.equal(badServerKey.status, 401);
  const firstGameJoin = await callServerRaw('POST', '/v1/server/admit', {
    ticket: firstTicket.ticket, serverId: 'dedicated-eu-01'
  });
  assert.equal(firstGameJoin.status, 200);
  assert.equal(firstGameJoin.body.identity.isOwner, false, 'redeeming a ticket is not yet a successful join');
  assert.equal(firstGameJoin.body.identity.accountId, 'social-player-002');
  assert.equal(firstGameJoin.body.identity.username, 'penguin0002');
  const profileBeforeConnected = await call('social-player-002', 'GET', '/v1/profile/me');
  assert.equal(profileBeforeConnected.isOwner, false);

  const ticketHash = createHash('sha256').update(firstTicket.ticket).digest('hex');
  const badConfirmKey = await callServerRaw('POST', '/v1/server/confirm-join', {
    ticketHash, serverId: 'dedicated-eu-01'
  }, 'wrong-server-secret');
  assert.equal(badConfirmKey.status, 401);
  const confirmedJoin = await callServerRaw('POST', '/v1/server/confirm-join', {
    ticketHash, serverId: 'dedicated-eu-01'
  });
  assert.equal(confirmedJoin.status, 200);
  assert.equal(confirmedJoin.body.confirmed, true);
  assert.equal(confirmedJoin.body.identity.isOwner, true);
  const profileAfterFirstJoin = await call('social-player-002', 'GET', '/v1/profile/me');
  assert.equal(profileAfterFirstJoin.isOwner, true);
  assert.equal(profileAfterFirstJoin.accountId, 'social-player-002');

  const confirmRetry = await callServerRaw('POST', '/v1/server/confirm-join', {
    ticketHash, serverId: 'dedicated-eu-01'
  });
  assert.equal(confirmRetry.status, 200);
  assert.equal(confirmRetry.body.alreadyConfirmed, true);
  const replay = await callServerRaw('POST', '/v1/server/admit', {
    ticket: firstTicket.ticket, serverId: 'dedicated-eu-01'
  });
  assert.equal(replay.status, 401);
  const laterTicket = await call('social-player-001', 'POST', '/v1/server/tickets', { serverId: 'dedicated-eu-01' });
  const laterGameJoin = await callServerRaw('POST', '/v1/server/admit', {
    ticket: laterTicket.ticket, serverId: 'dedicated-eu-01'
  });
  assert.equal(laterGameJoin.body.identity.isOwner, false);
  const laterHash = createHash('sha256').update(laterTicket.ticket).digest('hex');
  const laterConfirmed = await callServerRaw('POST', '/v1/server/confirm-join', {
    ticketHash: laterHash, serverId: 'dedicated-eu-01'
  });
  assert.equal(laterConfirmed.body.identity.isOwner, false);

  const request = await call('social-player-001', 'POST', '/v1/social/friend-requests', {
    targetAccountId: 'social-player-002'
  });
  const incoming = await call('social-player-002', 'GET', '/v1/social/friend-requests');
  assert.equal(incoming.incoming.length, 1);
  await call('social-player-002', 'POST', `/v1/social/friend-requests/${request.requestId}/accept`, {});
  const friends = await call('social-player-001', 'GET', '/v1/social/friends');
  assert.equal(friends.entries.length, 1);
  assert.equal(friends.entries[0].accountId, 'social-player-002');

  await call('social-player-001', 'POST', '/v1/social/recent-players', {
    targetAccountId: 'social-player-002', serverId: 'test-relay-room'
  });
  const recent = await call('social-player-001', 'GET', '/v1/social/recent-players');
  assert.equal(recent.entries.length, 1);
  assert.equal(recent.entries[0].username, 'penguin0002');
  assert.equal(recent.entries[0].encounterCount, 1);

  const privateRecent = await call('social-player-002', 'GET', '/v1/social/recent-players');
  assert.equal(privateRecent.entries.length, 0);

  const ownerCosmetics = await call('social-player-002', 'GET', '/v1/cosmetics');
  assert.equal(ownerCosmetics.isOwner, true);
  const ownerPet = ownerCosmetics.entries.find(item => item.id === 'owner-penguin');
  assert.equal(ownerPet.owned, true);
  const ownerEquip = await call('social-player-002', 'POST', '/v1/cosmetics/equip', { cosmeticId: 'owner-penguin' });
  assert.equal(ownerEquip.equipped, true);

  const regularCosmetics = await call('social-player-001', 'GET', '/v1/cosmetics');
  assert.equal(regularCosmetics.isOwner, false);
  assert.equal(regularCosmetics.entries.find(item => item.id === 'owner-penguin').owned, false);
  await call('social-player-001', 'POST', '/v1/rewards/daily/claim', {});
  const capPurchase = await call('social-player-001', 'POST', '/v1/cosmetics/purchase', { cosmeticId: 'classic-cap' });
  assert.equal(capPurchase.purchased, true);
  assert.equal(capPurchase.balance, 0);
  await call('social-player-001', 'POST', '/v1/cosmetics/equip', { cosmeticId: 'classic-cap' });
  const regularAfterPurchase = await call('social-player-001', 'GET', '/v1/cosmetics');
  const capState = regularAfterPurchase.entries.find(item => item.id === 'classic-cap');
  assert.equal(capState.owned, true);
  assert.equal(capState.equipped, true);
  const duplicatePurchase = await call('social-player-001', 'POST', '/v1/cosmetics/purchase', { cosmeticId: 'classic-cap' });
  assert.equal(duplicatePurchase.purchased, false);
  assert.equal(duplicatePurchase.alreadyOwned, true);
  assert.equal(duplicatePurchase.balance, 0);
  const forgedEquip = await fetch(`http://127.0.0.1:${apiPort}/v1/cosmetics/equip`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${makeToken('social-player-001', privateKey, issuer, audience)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ cosmeticId: 'owner-penguin' })
  });
  assert.equal(forgedEquip.status, 400);
  const forgedBody = await forgedEquip.json();
  assert.match(forgedBody.message, /verified game owner/i);

  await call('social-player-003', 'POST', '/v1/reports', {
    targetAccountId: 'social-player-001', reason: 'Harassment',
    serverId: 'relay-moderation-room', gameMode: 'Tag'
  });
  const nonOwnerReports = await callRaw('social-player-001', 'GET', '/v1/owner/moderation/reports');
  assert.equal(nonOwnerReports.status, 403);
  assert.equal(nonOwnerReports.body.error, 'owner_required');

  const ownerReports = await call('social-player-002', 'GET', '/v1/owner/moderation/reports');
  assert.equal(ownerReports.reports.length, 1);
  assert.equal(ownerReports.reports[0].reporterAccountId, 'social-player-003');
  assert.equal(ownerReports.reports[0].serverId, 'relay-moderation-room');
  const playerDetails = await call('social-player-002', 'GET', '/v1/owner/moderation/players/social-player-001');
  assert.equal(playerDetails.account.username, 'penguin0001');
  assert.equal(playerDetails.reports.length, 1);
  const nonOwnerBan = await callRaw('social-player-001', 'POST', '/v1/owner/moderation/bans', {
    targetAccountId: 'social-player-003', reason: 'Cheating', duration: '10m'
  });
  assert.equal(nonOwnerBan.status, 403);

  const ban = await call('social-player-002', 'POST', '/v1/owner/moderation/bans', {
    targetAccountId: 'social-player-001', reason: 'Harassment',
    reasonDetails: 'Test moderation action', duration: '10m'
  });
  assert.equal(ban.issued, true);
  assert.equal(ban.durationSeconds, 600);
  const serverValidation = await callServerRaw('POST', '/v1/server/validate', {
    accountIds: ['social-player-001', 'social-player-002']
  });
  assert.equal(serverValidation.status, 200);
  assert.deepEqual(serverValidation.body.bannedAccountIds, ['social-player-001']);
  const ownerBanList = await call('social-player-002', 'GET', '/v1/owner/moderation/bans');
  assert.equal(ownerBanList.entries.length, 1);
  assert.equal(ownerBanList.entries[0].status, 'active');
  const moderationSummary = await call('social-player-002', 'GET', '/v1/owner/moderation/summary');
  assert.equal(moderationSummary.recentBans.length, 1);
  const banScreen = await call('social-player-001', 'GET', '/v1/access');
  assert.equal(banScreen.banned, true);
  assert.equal(banScreen.ban.reason, 'Harassment');
  assert.equal(banScreen.ban.appealInstructions.includes('support'), true);

  const bannedProfile = await callRaw('social-player-001', 'GET', '/v1/profile/me');
  assert.equal(bannedProfile.status, 403);
  assert.equal(bannedProfile.body.error, 'account_banned');
  const bannedCosmetics = await callRaw('social-player-001', 'GET', '/v1/cosmetics');
  assert.equal(bannedCosmetics.status, 403);
  const bannedJoinRegistration = await callRaw('social-player-001', 'POST', '/v1/game/join', { sessionId: 'blocked-session-001' });
  assert.equal(bannedJoinRegistration.status, 403);

  const revoked = await call('social-player-002', 'POST', `/v1/owner/moderation/bans/${ban.banId}/revoke`, {
    note: 'Integration test appeal'
  });
  assert.equal(revoked.revoked, true);
  const restoredAccess = await call('social-player-001', 'GET', '/v1/access');
  assert.equal(restoredAccess.allowed, true);
  const restoredProfile = await call('social-player-001', 'GET', '/v1/profile/me');
  assert.equal(restoredProfile.accountId, 'social-player-001');
});
