import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../account-store.mjs';

function withStore(callback) {
  const folder = mkdtempSync(join(tmpdir(), 'penguin-vr-moderation-'));
  const store = new AccountStore(join(folder, 'test.sqlite'));
  try { callback(store); }
  finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
}

function seedOwnerAndPlayers(store) {
  for (const id of ['moderator-owner-001', 'moderated-player-002', 'reporter-player-003'])
    store.createOrGetAccount(id, 1000);
  store.recordGameJoin('moderator-owner-001', 'moderation-session-001', 2000);
}

test('only the first authenticated game owner can read moderation records or issue bans', () => {
  withStore(store => {
    seedOwnerAndPlayers(store);
    assert.throws(() => store.listOwnerReports('moderated-player-002'), error => error.statusCode === 403);
    assert.throws(() => store.issueBan('moderated-player-002', {
      targetAccountId: 'reporter-player-003', reason: 'Cheating', duration: '1h'
    }), error => error.statusCode === 403);
  });
});

test('owner can inspect report metadata, player history and issue a timed ban', () => {
  withStore(store => {
    seedOwnerAndPlayers(store);
    store.createReport('reporter-player-003', {
      targetAccountId: 'moderated-player-002', reason: 'Harassment',
      serverId: 'relay-room-abc', gameMode: 'Tag'
    }, 3000);

    const reportData = store.listOwnerReports('moderator-owner-001');
    assert.equal(reportData.reports.length, 1);
    assert.equal(reportData.reports[0].reporterAccountId, 'reporter-player-003');
    assert.equal(reportData.reports[0].targetUsername, 'penguin0002');
    assert.equal(reportData.reports[0].serverId, 'relay-room-abc');
    assert.equal(reportData.reports[0].gameMode, 'Tag');

    const details = store.getOwnerPlayerDetails('moderator-owner-001', 'moderated-player-002', 3001);
    assert.equal(details.account.accountId, 'moderated-player-002');
    assert.equal(details.reports.length, 1);

    const ban = store.issueBan('moderator-owner-001', {
      targetAccountId: 'moderated-player-002', reason: 'Harassment',
      reasonDetails: 'Repeated targeted harassment', duration: '1h'
    }, 4000);
    assert.equal(ban.issued, true);
    assert.equal(ban.expiresAt, 7600);
    assert.equal(store.getAccessStatus('moderated-player-002', 4001).banned, true);
    assert.equal(store.getAccessStatus('moderated-player-002', 4001).ban.reasonDetails, 'Repeated targeted harassment');
    assert.equal(store.getAccessStatus('moderated-player-002', 7600).allowed, true);
    assert.equal(store.listOwnerBans('moderator-owner-001', 100, 7600)[0].status, 'expired');
  });
});

test('permanent and custom bans validate durations and retain revocation audit history', () => {
  withStore(store => {
    seedOwnerAndPlayers(store);
    const permanent = store.issueBan('moderator-owner-001', {
      targetAccountId: 'moderated-player-002', reason: 'Exploiting', duration: 'permanent'
    }, 5000);
    assert.equal(permanent.permanent, true);
    assert.equal(permanent.expiresAt, null);
    assert.equal(store.getAccessStatus('moderated-player-002', 99999999).banned, true);
    assert.throws(() => store.issueBan('moderator-owner-001', {
      targetAccountId: 'reporter-player-003', reason: 'Cheating', duration: 'custom', customSeconds: 30
    }, 5001), /between 60 seconds and 365 days/i);

    const custom = store.issueBan('moderator-owner-001', {
      targetAccountId: 'reporter-player-003', reason: 'Cheating', duration: 'custom', customSeconds: 7200
    }, 6000);
    assert.equal(custom.expiresAt, 13200);

    const revoked = store.revokeBan('moderator-owner-001', permanent.banId, 'Successful appeal', 7000);
    assert.equal(revoked.revoked, true);
    assert.equal(store.getAccessStatus('moderated-player-002', 7001).allowed, true);
    const history = store.listOwnerBans('moderator-owner-001', 100, 7001);
    assert.equal(history.find(item => item.id === permanent.banId).status, 'revoked');
    assert.equal(history.find(item => item.id === permanent.banId).revokeNote, 'Successful appeal');
  });
});

test('owner cannot ban themselves and a new ban supersedes an existing active ban', () => {
  withStore(store => {
    seedOwnerAndPlayers(store);
    assert.throws(() => store.issueBan('moderator-owner-001', {
      targetAccountId: 'moderator-owner-001', reason: 'Other', duration: '10m'
    }, 8000), /cannot ban their own account/i);

    const first = store.issueBan('moderator-owner-001', {
      targetAccountId: 'moderated-player-002', reason: 'Cheating', duration: '10m'
    }, 8100);
    const second = store.issueBan('moderator-owner-001', {
      targetAccountId: 'moderated-player-002', reason: 'Exploiting', duration: '24h'
    }, 8200);
    assert.equal(store.getAccessStatus('moderated-player-002', 8201).ban.id, second.banId);
    const history = store.listOwnerBans('moderator-owner-001', 100, 8201);
    assert.equal(history.find(item => item.id === first.banId).status, 'revoked');
    assert.equal(history.find(item => item.id === second.banId).status, 'active');
  });
});
