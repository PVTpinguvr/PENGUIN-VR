import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../account-store.mjs';

function withStore(callback) {
  const folder = mkdtempSync(join(tmpdir(), 'penguin-vr-test-'));
  const store = new AccountStore(join(folder, 'test.sqlite'));
  try { callback(store); }
  finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
}

test('allocates persistent sequential penguin usernames once per authenticated account', () => {
  withStore(store => {
    const one = store.createOrGetAccount('account-001', 1000);
    const two = store.createOrGetAccount('account-002', 1000);
    const oneAgain = store.createOrGetAccount('account-001', 1001);
    assert.equal(one.username, 'penguin0001');
    assert.equal(two.username, 'penguin0002');
    assert.equal(oneAgain.username, 'penguin0001');
  });
});

test('rejects duplicate usernames and validates the allowed format', () => {
  withStore(store => {
    store.createOrGetAccount('account-001', 1000);
    store.createOrGetAccount('account-002', 1000);
    assert.throws(() => store.changeUsername('account-002', 'penguin0001'), /already taken/i);
    assert.throws(() => store.changeUsername('account-002', 'no spaces'), /3–16/);
    assert.equal(store.changeUsername('account-002', 'Pingu_02').username, 'Pingu_02');
  });
});

test('daily reward is exactly 100 bucks and cannot be reclaimed inside 24 hours', () => {
  withStore(store => {
    store.createOrGetAccount('account-001', 1000);
    const first = store.claimDailyReward('account-001', 10_000);
    const tooSoon = store.claimDailyReward('account-001', 10_000 + 86_399);
    const nextDay = store.claimDailyReward('account-001', 10_000 + 86_400);
    assert.equal(first.amount, 100);
    assert.equal(first.balance, 100);
    assert.equal(tooSoon.claimed, false);
    assert.equal(tooSoon.balance, 100);
    assert.equal(nextDay.balance, 200);
  });
});

test('ten distinct reports create urgent review but never issue an automatic ban', () => {
  withStore(store => {
    for (let i = 1; i <= 11; i++) store.createOrGetAccount(`account-${String(i).padStart(3, '0')}`, 1000);
    let result;
    for (let i = 1; i <= 10; i++) {
      result = store.createReport(`account-${String(i).padStart(3, '0')}`, {
        targetAccountId: 'account-011', reason: 'Harassment', serverId: 'test', gameMode: 'Tag'
      }, 20_000 + i);
    }
    assert.equal(result.urgentReview, true);
    assert.equal(result.automaticBan, false);
    assert.throws(() => store.createReport('account-001', {
      targetAccountId: 'account-011', reason: 'Harassment'
    }, 20_100), /already reported/i);
  });
});

test('friend requests are account-owned, target-accepted and stored as canonical friendships', () => {
  withStore(store => {
    store.createOrGetAccount('account-001', 1000);
    store.createOrGetAccount('account-002', 1000);
    store.createOrGetAccount('account-003', 1000);

    const request = store.sendFriendRequest('account-001', 'account-002', 2000);
    assert.equal(request.accepted, true);
    assert.equal(store.listFriendRequests('account-002').incoming[0].username, 'penguin0001');
    assert.equal(store.listFriendRequests('account-001').outgoing[0].accountId, 'account-002');
    assert.equal(store.listFriends('account-001').length, 0);

    assert.throws(() => store.respondToFriendRequest('account-003', request.requestId, true, 2001), /not found/i);
    assert.throws(() => store.sendFriendRequest('account-002', 'account-001', 2002), /already sent you/i);
    const result = store.respondToFriendRequest('account-002', request.requestId, true, 2003);
    assert.equal(result.status, 'accepted');
    assert.equal(store.listFriends('account-001')[0].accountId, 'account-002');
    assert.equal(store.listFriends('account-002')[0].accountId, 'account-001');
    assert.throws(() => store.sendFriendRequest('account-001', 'account-002', 2004), /already friends/i);

    assert.deepEqual(store.removeFriend('account-001', 'account-002'), { removed: true, accountId: 'account-002' });
    assert.equal(store.listFriends('account-001').length, 0);
    assert.equal(store.sendFriendRequest('account-001', 'account-002', 2005).status, 'pending');
  });
});

test('friend request can be declined and the receiver controls acceptance', () => {
  withStore(store => {
    store.createOrGetAccount('account-101', 1000);
    store.createOrGetAccount('account-102', 1000);
    const request = store.sendFriendRequest('account-101', 'account-102', 3000);
    const declined = store.respondToFriendRequest('account-102', request.requestId, false, 3001);
    assert.equal(declined.status, 'declined');
    assert.equal(store.listFriends('account-101').length, 0);
    assert.equal(store.listFriendRequests('account-102').incoming.length, 0);
    assert.throws(() => store.respondToFriendRequest('account-102', request.requestId, true, 3002), /no longer pending/i);
  });
});

test('recent players are per-viewer, ordered by latest encounter and increment encounter counts', () => {
  withStore(store => {
    for (const id of ['account-201', 'account-202', 'account-203']) store.createOrGetAccount(id, 1000);
    store.recordRecentPlayer('account-201', 'account-202', 'relay-room-a', 4000);
    store.recordRecentPlayer('account-201', 'account-203', 'relay-room-b', 4010);
    store.recordRecentPlayer('account-201', 'account-202', 'relay-room-c', 4020);

    const recent = store.listRecentPlayers('account-201');
    assert.equal(recent[0].accountId, 'account-202');
    assert.equal(recent[0].encounterCount, 2);
    assert.equal(recent[0].lastServerId, 'relay-room-c');
    assert.equal(recent[1].accountId, 'account-203');
    assert.equal(store.listRecentPlayers('account-202').length, 0);
    assert.throws(() => store.recordRecentPlayer('account-201', 'account-201'), /yourself/i);
  });
});


test('cosmetic catalogue is server-owned and purchases deduct Penguin Bucks exactly once', () => {
  withStore(store => {
    store.createOrGetAccount('cosmetic-player-001', 1000);
    store.claimDailyReward('cosmetic-player-001', 10_000);
    store.claimDailyReward('cosmetic-player-001', 10_000 + 86_400);
    const before = store.listCosmetics('cosmetic-player-001', 100_000);
    assert.equal(before.balance, 200);
    const cap = before.entries.find(item => item.id === 'classic-cap');
    assert.equal(cap.owned, false);
    assert.equal(cap.price, 100);
    const purchase = store.purchaseCosmetic('cosmetic-player-001', 'classic-cap', 100_001);
    assert.equal(purchase.purchased, true);
    assert.equal(purchase.balance, 100);
    const duplicate = store.purchaseCosmetic('cosmetic-player-001', 'classic-cap', 100_002);
    assert.equal(duplicate.purchased, false);
    assert.equal(duplicate.alreadyOwned, true);
    assert.equal(duplicate.balance, 100);
    assert.throws(() => store.purchaseCosmetic('cosmetic-player-001', 'snow-backpack', 100_003), /not enough/i);
    const after = store.listCosmetics('cosmetic-player-001', 100_004);
    assert.equal(after.entries.find(item => item.id === 'classic-cap').owned, true);
  });
});

test('recorded game join helper permanently preserves the first account; profile creation alone does not', () => {
  withStore(store => {
    const firstProfile = store.createOrGetAccount('first-profile-account', 1000);
    const secondProfile = store.createOrGetAccount('second-profile-account', 1001);
    assert.equal(firstProfile.isOwner, false);
    assert.equal(secondProfile.isOwner, false);
    assert.equal(store.getGameOwner(), null);

    // The second registered profile enters a multiplayer room first.
    const ownerJoin = store.recordGameJoin('second-profile-account', 'relay-session-first', 2000);
    const laterJoin = store.recordGameJoin('first-profile-account', 'relay-session-later', 2001);
    assert.equal(ownerJoin.isOwner, true);
    assert.equal(laterJoin.isOwner, false);
    assert.equal(store.getAccount('second-profile-account').isOwner, true);
    assert.equal(store.getAccount('first-profile-account').isOwner, false);

    // Rejoins never replace the original owner claim.
    const repeatedJoin = store.recordGameJoin('first-profile-account', 'relay-session-later', 2002);
    assert.equal(repeatedJoin.isOwner, false);
    assert.equal(repeatedJoin.joinCount, 2);

    const ownerCatalog = store.listCosmetics('second-profile-account', 2003);
    const ownerItem = ownerCatalog.entries.find(item => item.id === 'owner-penguin');
    assert.equal(ownerCatalog.isOwner, true);
    assert.equal(ownerItem.owned, true);
    assert.equal(ownerItem.ownerOnly, true);
    assert.throws(() => store.purchaseCosmetic('first-profile-account', 'owner-penguin', 2004), /cannot be purchased/i);
    assert.throws(() => store.equipCosmetic('first-profile-account', 'owner-penguin', 2005), /only available/i);
    const equip = store.equipCosmetic('second-profile-account', 'owner-penguin', 2006);
    assert.equal(equip.equipped, true);
    assert.equal(equip.slot, 'companion');
    assert.equal(store.listCosmetics('second-profile-account', 2007).entries
      .find(item => item.id === 'owner-penguin').equipped, true);
    assert.equal(store.listCosmetics('first-profile-account', 2008).isOwner, false);
  });
});

test('equipping cosmetics requires ownership and one item per slot; unequip clears the slot', () => {
  withStore(store => {
    store.createOrGetAccount('cosmetic-player-002', 1000);
    assert.throws(() => store.equipCosmetic('cosmetic-player-002', 'classic-cap', ''), /do not own/i);
    store.claimDailyReward('cosmetic-player-002', 5000);
    store.claimDailyReward('cosmetic-player-002', 5000 + 86400);
    store.purchaseCosmetic('cosmetic-player-002', 'classic-cap', 200000);
    store.equipCosmetic('cosmetic-player-002', 'classic-cap', 200001);
    assert.equal(store.listCosmetics('cosmetic-player-002').entries.find(item => item.id === 'classic-cap').equipped, true);
    assert.deepEqual(store.unequipCosmetic('cosmetic-player-002', 'hat'), { unequipped: true, slot: 'hat' });
    assert.equal(store.listCosmetics('cosmetic-player-002').entries.find(item => item.id === 'classic-cap').equipped, false);
    assert.throws(() => store.unequipCosmetic('cosmetic-player-002', 'invalid-slot'), /invalid/i);
  });
});

test('first-owner claim survives reopening the account database', () => {
  const folder = mkdtempSync(join(tmpdir(), 'penguin-vr-owner-persist-'));
  const databasePath = join(folder, 'persistent.sqlite');
  const first = new AccountStore(databasePath);
  try {
    first.createOrGetAccount('persistent-owner-001', 1000);
    first.createOrGetAccount('persistent-player-002', 1001);
    first.recordGameJoin('persistent-owner-001', 'relay-persistent-1', 2000);
  } finally {
    first.close();
  }

  const reopened = new AccountStore(databasePath);
  try {
    assert.equal(reopened.isGameOwner('persistent-owner-001'), true);
    assert.equal(reopened.isGameOwner('persistent-player-002'), false);
    assert.equal(reopened.getGameOwner().claimedAt, 2000);
  } finally {
    reopened.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('Stage 4.4 database migration picks the earliest registered legacy account', () => {
  const folder = mkdtempSync(join(tmpdir(), 'penguin-vr-legacy-owner-'));
  const databasePath = join(folder, 'legacy.sqlite');
  const legacyDb = new DatabaseSync(databasePath);
  legacyDb.exec(`
    CREATE TABLE accounts (
      account_id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      colour_hex TEXT NOT NULL DEFAULT '#FFFFFF',
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      playtime_seconds INTEGER NOT NULL DEFAULT 0,
      penguin_bucks INTEGER NOT NULL DEFAULT 0,
      last_daily_claim_at INTEGER NOT NULL DEFAULT 0,
      preferences_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO accounts(account_id, username, created_at, updated_at)
      VALUES ('legacy-second-001', 'penguin0002', 200, 200);
    INSERT INTO accounts(account_id, username, created_at, updated_at)
      VALUES ('legacy-first-001', 'penguin0001', 100, 100);
  `);
  legacyDb.close();

  const migrated = new AccountStore(databasePath);
  try {
    assert.equal(migrated.isGameOwner('legacy-first-001'), true);
    assert.equal(migrated.isGameOwner('legacy-second-001'), false);
    assert.equal(migrated.getGameOwner().claimSource, 'legacy_first_registered_account');
  } finally {
    migrated.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a new database never promotes the earliest profile on restart before a real game admission', () => {
  const folder = mkdtempSync(join(tmpdir(), 'penguin-vr-unclaimed-owner-'));
  const databasePath = join(folder, 'fresh.sqlite');
  const firstBoot = new AccountStore(databasePath);
  firstBoot.createOrGetAccount('profile-created-first', 1000);
  firstBoot.close();

  const secondBoot = new AccountStore(databasePath);
  try {
    assert.equal(secondBoot.getGameOwner(), null);
    secondBoot.createOrGetAccount('profile-created-second', 1001);
    const ticketHash = 'e'.repeat(64);
    secondBoot.issueServerAdmissionTicket('profile-created-second', ticketHash, 'dedicated-test-01', 2000);
    const admitted = secondBoot.redeemServerAdmissionTicket(ticketHash, 'dedicated-test-01', 2001);
    assert.equal(admitted.identity.accountId, 'profile-created-second');
    assert.equal(admitted.identity.isOwner, false, 'ticket redemption alone must not claim ownership');
    assert.equal(secondBoot.getGameOwner(), null);
    const confirmed = secondBoot.confirmServerAdmissionJoin(ticketHash, 'dedicated-test-01', 2002);
    assert.equal(confirmed.identity.isOwner, true);
    assert.equal(secondBoot.isGameOwner('profile-created-first'), false);
  } finally {
    secondBoot.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('dedicated admission tickets are one-use and ownership is claimed only after confirmed NGO connection', () => {
  withStore(store => {
    store.createOrGetAccount('dedicated-first-player', 1000);
    store.createOrGetAccount('dedicated-second-player', 1001);
    const firstHash = 'a'.repeat(64);
    store.issueServerAdmissionTicket('dedicated-first-player', firstHash, 'dedicated-eu-01', 2000);
    assert.throws(() => store.redeemServerAdmissionTicket(firstHash, 'dedicated-us-01', 2001), /expired, already used, or belongs to another server/i);
    const first = store.redeemServerAdmissionTicket(firstHash, 'dedicated-eu-01', 2002);
    assert.equal(first.admitted, true);
    assert.equal(first.identity.isOwner, false, 'ticket redemption alone must not claim the owner slot');
    assert.equal(first.identity.accountId, 'dedicated-first-player');
    assert.equal(first.identity.username, 'penguin0001');
    assert.equal(store.getGameOwner(), null);
    assert.throws(() => store.redeemServerAdmissionTicket(firstHash, 'dedicated-eu-01', 2003), /expired, already used, or belongs to another server/i);

    const confirmed = store.confirmServerAdmissionJoin(firstHash, 'dedicated-eu-01', 2004);
    assert.equal(confirmed.confirmed, true);
    assert.equal(confirmed.identity.isOwner, true);
    assert.equal(store.getGameOwner().accountId, 'dedicated-first-player');
    const retry = store.confirmServerAdmissionJoin(firstHash, 'dedicated-eu-01', 2005);
    assert.equal(retry.alreadyConfirmed, true);
    assert.equal(store.db.prepare('SELECT join_count AS count FROM game_join_history WHERE account_id = ?').get('dedicated-first-player').count, 1);

    const secondHash = 'b'.repeat(64);
    store.issueServerAdmissionTicket('dedicated-second-player', secondHash, 'dedicated-eu-01', 2010);
    const second = store.redeemServerAdmissionTicket(secondHash, 'dedicated-eu-01', 2011);
    assert.equal(second.identity.isOwner, false);
    const secondConfirmed = store.confirmServerAdmissionJoin(secondHash, 'dedicated-eu-01', 2012);
    assert.equal(secondConfirmed.identity.isOwner, false);
  });
});


test('owner is the first successfully confirmed connection, not the first ticket requester', () => {
  withStore(store => {
    store.createOrGetAccount('ticket-requester-first', 1000);
    store.createOrGetAccount('confirmed-joiner-first', 1001);

    const earlierTicket = '1'.repeat(64);
    const laterTicket = '2'.repeat(64);
    store.issueServerAdmissionTicket('ticket-requester-first', earlierTicket, 'dedicated-eu-03', 3000);
    store.issueServerAdmissionTicket('confirmed-joiner-first', laterTicket, 'dedicated-eu-03', 3001);

    // Both players have tickets redeemed, but NGO confirmation for the second account
    // arrives first. The owner must follow successful join order, not ticket order.
    store.redeemServerAdmissionTicket(earlierTicket, 'dedicated-eu-03', 3002);
    store.redeemServerAdmissionTicket(laterTicket, 'dedicated-eu-03', 3003);
    assert.equal(store.getGameOwner(), null);

    const actualFirstJoin = store.confirmServerAdmissionJoin(laterTicket, 'dedicated-eu-03', 3004);
    const actualSecondJoin = store.confirmServerAdmissionJoin(earlierTicket, 'dedicated-eu-03', 3005);
    assert.equal(actualFirstJoin.identity.isOwner, true);
    assert.equal(actualSecondJoin.identity.isOwner, false);
    assert.equal(store.getGameOwner().accountId, 'confirmed-joiner-first');
  });
});

test('adds the confirmation timestamp when upgrading an earlier Stage 6 ticket table', () => {
  const folder = mkdtempSync(join(tmpdir(), 'penguin-vr-stage6-ticket-migration-'));
  const databasePath = join(folder, 'stage6.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE server_admission_tickets (
      ticket_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      redeemed_at INTEGER,
      redeemed_by_server_id TEXT NOT NULL DEFAULT ''
    );
  `);
  legacy.close();

  const upgraded = new AccountStore(databasePath);
  try {
    const columns = upgraded.db.prepare('PRAGMA table_info(server_admission_tickets)').all().map(column => column.name);
    assert.equal(columns.includes('confirmed_at'), true);
  } finally {
    upgraded.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('dedicated admission ticket expiry and bans are rechecked at redemption and join confirmation', () => {
  withStore(store => {
    store.createOrGetAccount('dedicated-owner-player', 1000);
    store.createOrGetAccount('dedicated-banned-player', 1001);
    store.createOrGetAccount('dedicated-pending-player', 1002);
    store.recordGameJoin('dedicated-owner-player', 'legacy-owner-session', 1100);
    const expiredHash = 'c'.repeat(64);
    store.issueServerAdmissionTicket('dedicated-banned-player', expiredHash, 'dedicated-eu-02', 2000);
    assert.throws(() => store.redeemServerAdmissionTicket(expiredHash, 'dedicated-eu-02', 2061), /expired, already used, or belongs to another server/i);

    const activeHash = 'd'.repeat(64);
    store.issueServerAdmissionTicket('dedicated-banned-player', activeHash, 'dedicated-eu-02', 2100);
    store.issueBan('dedicated-owner-player', {
      targetAccountId: 'dedicated-banned-player', reason: 'Cheating', duration: 'permanent'
    }, 2101);
    assert.throws(() => store.redeemServerAdmissionTicket(activeHash, 'dedicated-eu-02', 2102), error =>
      error.statusCode === 403 && error.code === 'account_banned');

    const pendingHash = 'f'.repeat(64);
    store.issueServerAdmissionTicket('dedicated-pending-player', pendingHash, 'dedicated-eu-02', 2200);
    assert.equal(store.redeemServerAdmissionTicket(pendingHash, 'dedicated-eu-02', 2201).admitted, true);
    store.issueBan('dedicated-owner-player', {
      targetAccountId: 'dedicated-pending-player', reason: 'Exploiting', duration: 'permanent'
    }, 2202);
    assert.throws(() => store.confirmServerAdmissionJoin(pendingHash, 'dedicated-eu-02', 2203), error =>
      error.statusCode === 403 && error.code === 'account_banned');
    assert.equal(store.db.prepare('SELECT 1 FROM game_join_history WHERE account_id = ?').get('dedicated-pending-player'), undefined);
    assert.equal(store.isGameOwner('dedicated-owner-player'), true);
  });
});
