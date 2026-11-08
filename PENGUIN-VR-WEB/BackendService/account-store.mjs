import { DatabaseSync } from 'node:sqlite';

const OWNER_COMPANION_ID = 'owner-penguin';
const COSMETIC_CATALOG = Object.freeze([
  { id: 'classic-cap', name: 'Classic Cap', slot: 'hat', price: 100, rarity: 'common', description: 'A simple navy cap.' },
  { id: 'star-glasses', name: 'Star Glasses', slot: 'face', price: 250, rarity: 'rare', description: 'Bright star-shaped glasses.' },
  { id: 'snow-backpack', name: 'Snow Backpack', slot: 'back', price: 400, rarity: 'rare', description: 'A compact winter pack.' },
  { id: 'blue-trail', name: 'Arctic Trail', slot: 'trail', price: 550, rarity: 'epic', description: 'A cool blue movement trail.' },
  { id: 'bubble-particles', name: 'Bubble Particles', slot: 'effect', price: 700, rarity: 'epic', description: 'Floating soap bubbles.' },
  { id: OWNER_COMPANION_ID, name: 'OWNER PENGUIN', slot: 'companion', price: 0, rarity: 'exclusive', description: 'A tiny penguin companion for the verified game owner.', ownerOnly: true }
]);

const REPORT_REASONS = new Set([
  'Cheating', 'Exploiting', 'Harassment', 'Inappropriate behaviour',
  'Offensive username', 'Hate speech', 'Voice chat abuse', 'Other'
]);

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export class AccountStore {
  constructor(databasePath = './penguin-vr.sqlite') {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    // Detect a real pre-Stage-4.5 database before creating the owner table. This
    // lets us preserve the historical fallback exactly once without claiming
    // the earliest profile in a new database that has not had a game join yet.
    const hadAccountsTable = Boolean(this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'accounts'"
    ).get());
    const hadGameOwnerTable = Boolean(this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'game_owner'"
    ).get());
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO counters(name, value) VALUES ('username_sequence', 1);

      CREATE TABLE IF NOT EXISTS accounts (
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

      -- A single permanent owner claim for the whole game. The row is intentionally
      -- independent of usernames and can only be created by the authenticated join flow.
      CREATE TABLE IF NOT EXISTS game_owner (
        singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
        account_id TEXT NOT NULL REFERENCES accounts(account_id),
        claimed_at INTEGER NOT NULL,
        claim_source TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS game_join_history (
        account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        first_joined_at INTEGER NOT NULL,
        last_joined_at INTEGER NOT NULL,
        join_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(account_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS game_join_history_first_joined
        ON game_join_history(first_joined_at);

      -- Short-lived, single-use tickets bridge player identity to a dedicated NGO server.
      -- Only SHA-256 hashes are persisted; raw tickets are returned once to the player.
      CREATE TABLE IF NOT EXISTS server_admission_tickets (
        ticket_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
        server_id TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        redeemed_at INTEGER,
        redeemed_by_server_id TEXT NOT NULL DEFAULT '',
        confirmed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS server_admission_tickets_expiry
        ON server_admission_tickets(expires_at, redeemed_at);

      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_account_id TEXT NOT NULL REFERENCES accounts(account_id),
        target_account_id TEXT NOT NULL REFERENCES accounts(account_id),
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        server_id TEXT NOT NULL DEFAULT '',
        game_mode TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS reports_target_time ON reports(target_account_id, created_at);
      CREATE INDEX IF NOT EXISTS reports_reporter_target_time ON reports(reporter_account_id, target_account_id, created_at);

      CREATE TABLE IF NOT EXISTS ban_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_account_id TEXT NOT NULL REFERENCES accounts(account_id),
        issued_by_account_id TEXT NOT NULL REFERENCES accounts(account_id),
        reason TEXT NOT NULL,
        reason_details TEXT NOT NULL DEFAULT '',
        duration_key TEXT NOT NULL,
        duration_seconds INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        revoked_by_account_id TEXT REFERENCES accounts(account_id),
        revoke_note TEXT NOT NULL DEFAULT '',
        CHECK (duration_seconds IS NULL OR duration_seconds > 0)
      );
      CREATE INDEX IF NOT EXISTS ban_records_target_created
        ON ban_records(target_account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS ban_records_expiry
        ON ban_records(expires_at, revoked_at);

      CREATE TABLE IF NOT EXISTS urgent_review_flags (
        target_account_id TEXT PRIMARY KEY REFERENCES accounts(account_id),
        report_count INTEGER NOT NULL,
        first_flagged_at INTEGER NOT NULL,
        last_updated_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'urgent_review'
      );

      CREATE TABLE IF NOT EXISTS friend_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
        target_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(requester_account_id, target_account_id),
        CHECK(requester_account_id <> target_account_id)
      );
      CREATE INDEX IF NOT EXISTS friend_requests_target_status
        ON friend_requests(target_account_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS friend_requests_requester_status
        ON friend_requests(requester_account_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS friendships (
        account_a TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
        account_b TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(account_a, account_b),
        CHECK(account_a < account_b)
      );
      CREATE INDEX IF NOT EXISTS friendships_account_b ON friendships(account_b, created_at DESC);

      CREATE TABLE IF NOT EXISTS recent_players (
        viewer_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
        target_account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
        last_seen_at INTEGER NOT NULL,
        encounter_count INTEGER NOT NULL DEFAULT 1,
        last_server_id TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(viewer_account_id, target_account_id),
        CHECK(viewer_account_id <> target_account_id)
      );
      CREATE INDEX IF NOT EXISTS recent_players_viewer_time
        ON recent_players(viewer_account_id, last_seen_at DESC);

      CREATE TABLE IF NOT EXISTS owned_cosmetics (
        account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
        cosmetic_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        PRIMARY KEY(account_id, cosmetic_id)
      );
      CREATE TABLE IF NOT EXISTS equipped_cosmetics (
        account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
        slot TEXT NOT NULL,
        cosmetic_id TEXT NOT NULL,
        equipped_at INTEGER NOT NULL,
        PRIMARY KEY(account_id, slot)
      );
      CREATE INDEX IF NOT EXISTS equipped_cosmetics_account ON equipped_cosmetics(account_id);
    `);
    const ticketColumns = new Set(this.db.prepare('PRAGMA table_info(server_admission_tickets)').all().map(column => column.name));
    if (!ticketColumns.has('confirmed_at'))
      this.db.exec('ALTER TABLE server_admission_tickets ADD COLUMN confirmed_at INTEGER');

    if (hadAccountsTable && !hadGameOwnerTable) this.migrateLegacyOwnerClaim();
  }

  close() { this.db.close(); }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getAccount(accountId) {
    const row = this.db.prepare('SELECT * FROM accounts WHERE account_id = ?').get(accountId);
    return row ? this.toProfile(row) : null;
  }

  /**
   * Stage 4.4 did not persist multiplayer join history and used OWNER_ACCOUNT_ID.
   * This fallback is called only when upgrading a database that had an accounts
   * table but no game_owner table before this constructor created the new schema.
   * New databases and existing Stage 4.5+ databases remain unclaimed until a
   * dedicated server confirms the first successful NGO connection after ticket redemption.
   */
  migrateLegacyOwnerClaim() {
    const current = this.db.prepare('SELECT account_id FROM game_owner WHERE singleton_id = 1').get();
    if (current) return;
    const firstAccount = this.db.prepare(`
      SELECT account_id, created_at FROM accounts
      ORDER BY created_at ASC, rowid ASC LIMIT 1
    `).get();
    if (!firstAccount) return;
    this.db.prepare(`
      INSERT OR IGNORE INTO game_owner(singleton_id, account_id, claimed_at, claim_source)
      VALUES (1, ?, ?, 'legacy_first_registered_account')
    `).run(firstAccount.account_id, firstAccount.created_at);
  }

  getGameOwner() {
    const row = this.db.prepare(`
      SELECT account_id AS accountId, claimed_at AS claimedAt, claim_source AS claimSource
      FROM game_owner WHERE singleton_id = 1
    `).get();
    return row || null;
  }

  isGameOwner(accountId) {
    if (typeof accountId !== 'string' || accountId.length < 3) return false;
    const owner = this.db.prepare('SELECT account_id FROM game_owner WHERE singleton_id = 1').get();
    return owner?.account_id === accountId;
  }

  issueServerAdmissionTicket(accountId, ticketHash, serverId, now = Math.floor(Date.now() / 1000)) {
    if (typeof ticketHash !== 'string' || !/^[a-f0-9]{64}$/.test(ticketHash))
      throw new Error('Admission ticket hash is invalid.');
    if (typeof serverId !== 'string' || !/^[A-Za-z0-9._:-]{3,64}$/.test(serverId))
      throw new Error('Dedicated server identifier is invalid.');
    return this.transaction(() => {
      this.requireAccount(accountId);
      const access = this.getAccessStatus(accountId, now);
      if (access.banned)
        throw Object.assign(new Error('This account is banned from PENGUIN VR.'), { statusCode: 403, code: 'account_banned', ban: access.ban });
      // Keep the table small even if a client repeatedly requests fresh tickets.
      this.db.prepare(`
        DELETE FROM server_admission_tickets
        WHERE confirmed_at IS NOT NULL
           OR (redeemed_at IS NULL AND expires_at <= ?)
           OR (redeemed_at IS NOT NULL AND confirmed_at IS NULL AND redeemed_at <= ?)
      `).run(now, now - 3600);
      const expiresAt = now + 60;
      this.db.prepare(`
        INSERT INTO server_admission_tickets(ticket_hash, account_id, server_id, issued_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(ticketHash, accountId, serverId, now, expiresAt);
      return { expiresAt, serverId };
    });
  }

  redeemServerAdmissionTicket(ticketHash, serverId, now = Math.floor(Date.now() / 1000)) {
    if (typeof ticketHash !== 'string' || !/^[a-f0-9]{64}$/.test(ticketHash))
      throw Object.assign(new Error('Admission ticket is invalid.'), { statusCode: 401, code: 'invalid_admission_ticket' });
    if (typeof serverId !== 'string' || !/^[A-Za-z0-9._:-]{3,64}$/.test(serverId))
      throw Object.assign(new Error('Dedicated server identifier is invalid.'), { statusCode: 400 });

    const ticket = this.transaction(() => {
      const row = this.db.prepare(`
        SELECT ticket_hash AS ticketHash, account_id AS accountId, server_id AS serverId,
               expires_at AS expiresAt, redeemed_at AS redeemedAt
        FROM server_admission_tickets WHERE ticket_hash = ?
      `).get(ticketHash);
      if (!row || row.redeemedAt != null || row.expiresAt <= now || row.serverId !== serverId)
        throw Object.assign(new Error('Admission ticket expired, already used, or belongs to another server.'), {
          statusCode: 401, code: 'invalid_admission_ticket'
        });
      const access = this.getAccessStatus(row.accountId, now);
      if (access.banned)
        throw Object.assign(new Error('This account is banned from PENGUIN VR.'), {
          statusCode: 403, code: 'account_banned', ban: access.ban
        });
      const update = this.db.prepare(`
        UPDATE server_admission_tickets
        SET redeemed_at = ?, redeemed_by_server_id = ?
        WHERE ticket_hash = ? AND redeemed_at IS NULL AND expires_at > ?
      `).run(now, serverId, ticketHash, now);
      if (Number(update.changes) !== 1)
        throw Object.assign(new Error('Admission ticket has already been redeemed.'), { statusCode: 409, code: 'ticket_replay' });
      return row;
    });

    // Ticket redemption proves eligibility and consumes the bearer ticket, but does not
    // claim the owner slot. Ownership is claimed only after NGO reports a successful
    // client-connected event and the trusted dedicated server calls confirmServerAdmissionJoin.
    return {
      admitted: true,
      identity: this.getDedicatedServerIdentity(ticket.accountId, now)
    };
  }

  confirmServerAdmissionJoin(ticketHash, serverId, now = Math.floor(Date.now() / 1000)) {
    if (typeof ticketHash !== 'string' || !/^[a-f0-9]{64}$/.test(ticketHash))
      throw Object.assign(new Error('Admission ticket hash is invalid.'), { statusCode: 401, code: 'invalid_admission_ticket' });
    if (typeof serverId !== 'string' || !/^[A-Za-z0-9._:-]{3,64}$/.test(serverId))
      throw Object.assign(new Error('Dedicated server identifier is invalid.'), { statusCode: 400 });

    const confirmed = this.transaction(() => {
      const row = this.db.prepare(`
        SELECT account_id AS accountId, server_id AS serverId, redeemed_at AS redeemedAt,
               redeemed_by_server_id AS redeemedByServerId, confirmed_at AS confirmedAt
        FROM server_admission_tickets WHERE ticket_hash = ?
      `).get(ticketHash);
      if (!row || row.redeemedAt == null || row.serverId !== serverId || row.redeemedByServerId !== serverId)
        throw Object.assign(new Error('Only a redeemed ticket for this server can confirm a join.'), {
          statusCode: 401, code: 'unredeemed_admission_ticket'
        });
      const access = this.getAccessStatus(row.accountId, now);
      if (access.banned)
        throw Object.assign(new Error('This account is banned from PENGUIN VR.'), {
          statusCode: 403, code: 'account_banned', ban: access.ban
        });

      if (row.confirmedAt == null) {
        this.db.prepare(`
          UPDATE server_admission_tickets SET confirmed_at = ?
          WHERE ticket_hash = ? AND confirmed_at IS NULL AND redeemed_by_server_id = ?
        `).run(now, ticketHash, serverId);
        this.recordGameJoinInsideTransaction(row.accountId, serverId, now);
      }
      return { accountId: row.accountId, alreadyConfirmed: row.confirmedAt != null };
    });

    return {
      confirmed: true,
      alreadyConfirmed: confirmed.alreadyConfirmed,
      identity: this.getDedicatedServerIdentity(confirmed.accountId, now)
    };
  }

  getDedicatedServerIdentity(accountId, now = Math.floor(Date.now() / 1000)) {
    const profile = this.getAccount(accountId);
    if (!profile) throw Object.assign(new Error('Account profile was not found.'), { statusCode: 404 });
    const cosmetics = this.listCosmetics(accountId, now);
    const equipped = {};
    for (const item of cosmetics.entries) {
      if (item.equipped) equipped[item.slot] = item.id;
    }
    const owner = this.getGameOwner();
    return {
      accountId: profile.accountId,
      username: profile.username,
      colourHex: profile.colourHex || '#FFFFFF',
      isOwner: owner?.accountId === accountId,
      ownerClaimedAt: owner?.claimedAt ?? 0,
      leftHanded: this.getPreferences(accountId).leftHanded,
      equippedCosmetics: equipped
    };
  }

  /** Record the real successful session entry inside an existing transaction. */
  recordGameJoinInsideTransaction(accountId, sessionId, now) {
    this.requireAccount(accountId);
    this.db.prepare(`
      INSERT INTO game_join_history(account_id, session_id, first_joined_at, last_joined_at, join_count)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(account_id, session_id) DO UPDATE SET
        last_joined_at = excluded.last_joined_at,
        join_count = game_join_history.join_count + 1
    `).run(accountId, sessionId, now, now);

    this.db.prepare(`
      INSERT OR IGNORE INTO game_owner(singleton_id, account_id, claimed_at, claim_source)
      VALUES (1, ?, ?, 'first_confirmed_dedicated_join')
    `).run(accountId, now);

    const owner = this.getGameOwner();
    const join = this.db.prepare(`
      SELECT first_joined_at AS firstJoinedAt, join_count AS joinCount
      FROM game_join_history WHERE account_id = ? AND session_id = ?
    `).get(accountId, sessionId);
    return {
      accepted: true,
      isOwner: owner?.accountId === accountId,
      ownerClaimedAt: owner?.claimedAt ?? 0,
      firstGameJoinAt: join.firstJoinedAt,
      joinCount: join.joinCount
    };
  }

  /**
   * Records a successful game-session entry. Direct calls are retained for unit/legacy
   * migrations; production HTTP admission uses confirmServerAdmissionJoin after NGO connects.
   */
  recordGameJoin(accountId, sessionId, now = Math.floor(Date.now() / 1000)) {
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9._:-]{3,128}$/.test(sessionId))
      throw new Error('Game session identifier is invalid.');
    return this.transaction(() => this.recordGameJoinInsideTransaction(accountId, sessionId, now));
  }

  createOrGetAccount(accountId, now = Math.floor(Date.now() / 1000)) {
    if (typeof accountId !== 'string' || accountId.length < 3 || accountId.length > 128) {
      throw new Error('Authenticated account identifier is invalid.');
    }
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM accounts WHERE account_id = ?').get(accountId);
      if (existing) return this.toProfile(existing);

      let sequence = this.db.prepare("SELECT value FROM counters WHERE name = 'username_sequence'").get().value;
      let username;
      do {
        username = `penguin${String(sequence).padStart(4, '0')}`;
        sequence += 1;
      } while (this.db.prepare('SELECT 1 FROM accounts WHERE username = ? COLLATE NOCASE').get(username));

      this.db.prepare("UPDATE counters SET value = ? WHERE name = 'username_sequence'").run(sequence);
      this.db.prepare(`
        INSERT INTO accounts(account_id, username, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(accountId, username, now, now);
      return this.toProfile(this.db.prepare('SELECT * FROM accounts WHERE account_id = ?').get(accountId));
    });
  }

  changeUsername(accountId, username, now = Math.floor(Date.now() / 1000)) {
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      throw new Error('Username must be 3–16 letters, numbers or underscores.');
    }
    const existingAccount = this.getAccount(accountId);
    if (!existingAccount) throw new Error('Account has not been created yet.');
    try {
      this.db.prepare('UPDATE accounts SET username = ?, updated_at = ? WHERE account_id = ?')
        .run(username, now, accountId);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new Error('That username is already taken.');
      throw error;
    }
    return this.getAccount(accountId);
  }

  getPreferences(accountId) {
    const row = this.db.prepare('SELECT preferences_json FROM accounts WHERE account_id = ?').get(accountId);
    if (!row) throw new Error('Account has not been created yet.');
    return this.normalisePreferences(JSON.parse(row.preferences_json || '{}'));
  }

  updatePreferences(accountId, input, now = Math.floor(Date.now() / 1000)) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Preferences object required.');
    const current = this.getPreferences(accountId);
    const muted = Array.isArray(input.mutedAccountIds) ? input.mutedAccountIds : current.mutedAccountIds;
    if (muted.length > 500 || muted.some(id => typeof id !== 'string' || id.length > 128)) {
      throw new Error('Muted account list is invalid.');
    }
    const preferences = this.normalisePreferences({
      mutedAccountIds: [...new Set(muted)],
      voiceEnabled: typeof input.voiceEnabled === 'boolean' ? input.voiceEnabled : current.voiceEnabled,
      pushToTalk: typeof input.pushToTalk === 'boolean' ? input.pushToTalk : current.pushToTalk,
      microphoneVolume: clampNumber(input.microphoneVolume, 0, 1, current.microphoneVolume),
      playerVolume: clampNumber(input.playerVolume, 0, 1, current.playerVolume),
      musicVolume: clampNumber(input.musicVolume, 0, 1, current.musicVolume),
      leftHanded: typeof input.leftHanded === 'boolean' ? input.leftHanded : current.leftHanded,
      graphicsQuality: Math.round(clampNumber(input.graphicsQuality, 0, 2, current.graphicsQuality))
    });
    this.db.prepare('UPDATE accounts SET preferences_json = ?, updated_at = ? WHERE account_id = ?')
      .run(JSON.stringify(preferences), now, accountId);
    return preferences;
  }

  claimDailyReward(accountId, now = Math.floor(Date.now() / 1000)) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT penguin_bucks, last_daily_claim_at FROM accounts WHERE account_id = ?').get(accountId);
      if (!row) throw new Error('Account has not been created yet.');
      const secondsPerDay = 24 * 60 * 60;
      const nextClaimAt = row.last_daily_claim_at + secondsPerDay;
      if (row.last_daily_claim_at > 0 && now < nextClaimAt) {
        return {
          claimed: false,
          amount: 0,
          balance: row.penguin_bucks,
          nextClaimAt,
          message: 'Daily reward already claimed. Come back after the cooldown.'
        };
      }
      const reward = 100;
      const balance = row.penguin_bucks + reward;
      this.db.prepare('UPDATE accounts SET penguin_bucks = ?, last_daily_claim_at = ?, updated_at = ? WHERE account_id = ?')
        .run(balance, now, now, accountId);
      return { claimed: true, amount: reward, balance, nextClaimAt: now + secondsPerDay, message: '100 Penguin Bucks claimed!' };
    });
  }

  listCosmetics(accountId, now = Math.floor(Date.now() / 1000)) {
    this.requireAccount(accountId);
    const isOwner = this.isGameOwner(accountId);
    if (isOwner) {
      // The exclusive companion is granted by the backend only to the configured owner identity.
      this.db.prepare(`INSERT OR IGNORE INTO owned_cosmetics(account_id, cosmetic_id, acquired_at)
        VALUES (?, ?, ?)`).run(accountId, OWNER_COMPANION_ID, now);
    } else {
      // If server configuration changes owners, the previous account loses the entitlement.
      this.db.prepare('DELETE FROM equipped_cosmetics WHERE account_id = ? AND slot = ? AND cosmetic_id = ?')
        .run(accountId, 'companion', OWNER_COMPANION_ID);
      this.db.prepare('DELETE FROM owned_cosmetics WHERE account_id = ? AND cosmetic_id = ?')
        .run(accountId, OWNER_COMPANION_ID);
    }
    const ownedRows = this.db.prepare('SELECT cosmetic_id FROM owned_cosmetics WHERE account_id = ?').all(accountId);
    const equippedRows = this.db.prepare('SELECT slot, cosmetic_id FROM equipped_cosmetics WHERE account_id = ?').all(accountId);
    const owned = new Set(ownedRows.map(row => row.cosmetic_id));
    const equipped = new Map(equippedRows.map(row => [row.slot, row.cosmetic_id]));
    const profile = this.db.prepare('SELECT penguin_bucks FROM accounts WHERE account_id = ?').get(accountId);
    return {
      isOwner,
      balance: profile.penguin_bucks,
      entries: COSMETIC_CATALOG.map(item => ({
        ...item,
        ownerOnly: item.ownerOnly === true,
        owned: owned.has(item.id),
        equipped: equipped.get(item.slot) === item.id
      }))
    };
  }

  purchaseCosmetic(accountId, cosmeticId, now = Math.floor(Date.now() / 1000)) {
    if (typeof cosmeticId !== 'string' || cosmeticId.length > 64) throw new Error('Cosmetic selection is invalid.');
    const item = COSMETIC_CATALOG.find(entry => entry.id === cosmeticId);
    if (!item) throw new Error('Cosmetic was not found.');
    if (item.ownerOnly) throw new Error('OWNER PENGUIN is exclusive and cannot be purchased.');
    return this.transaction(() => {
      const account = this.db.prepare('SELECT penguin_bucks FROM accounts WHERE account_id = ?').get(accountId);
      if (!account) throw new Error('Account has not been created yet.');
      const alreadyOwned = this.db.prepare('SELECT 1 FROM owned_cosmetics WHERE account_id = ? AND cosmetic_id = ?')
        .get(accountId, cosmeticId);
      if (alreadyOwned) return { purchased: false, alreadyOwned: true, cosmeticId, balance: account.penguin_bucks };
      if (account.penguin_bucks < item.price) throw new Error('Not enough Penguin Bucks.');
      const balance = account.penguin_bucks - item.price;
      this.db.prepare('UPDATE accounts SET penguin_bucks = ?, updated_at = ? WHERE account_id = ?')
        .run(balance, now, accountId);
      this.db.prepare('INSERT INTO owned_cosmetics(account_id, cosmetic_id, acquired_at) VALUES (?, ?, ?)')
        .run(accountId, cosmeticId, now);
      return { purchased: true, alreadyOwned: false, cosmeticId, balance };
    });
  }

  equipCosmetic(accountId, cosmeticId, now = Math.floor(Date.now() / 1000)) {
    if (typeof cosmeticId !== 'string' || cosmeticId.length > 64) throw new Error('Cosmetic selection is invalid.');
    const item = COSMETIC_CATALOG.find(entry => entry.id === cosmeticId);
    if (!item) throw new Error('Cosmetic was not found.');
    if (item.ownerOnly && !this.isGameOwner(accountId))
      throw new Error('OWNER PENGUIN is only available to the verified game owner.');
    this.requireAccount(accountId);
    if (item.ownerOnly) {
      this.db.prepare('INSERT OR IGNORE INTO owned_cosmetics(account_id, cosmetic_id, acquired_at) VALUES (?, ?, ?)')
        .run(accountId, cosmeticId, now);
    }
    const owned = this.db.prepare('SELECT 1 FROM owned_cosmetics WHERE account_id = ? AND cosmetic_id = ?')
      .get(accountId, cosmeticId);
    if (!owned) throw new Error('You do not own this cosmetic.');
    this.db.prepare(`INSERT INTO equipped_cosmetics(account_id, slot, cosmetic_id, equipped_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id, slot) DO UPDATE SET cosmetic_id = excluded.cosmetic_id, equipped_at = excluded.equipped_at`)
      .run(accountId, item.slot, cosmeticId, now);
    return { equipped: true, cosmeticId, slot: item.slot };
  }

  unequipCosmetic(accountId, slot) {
    const allowedSlots = new Set(COSMETIC_CATALOG.map(item => item.slot));
    if (typeof slot !== 'string' || !allowedSlots.has(slot)) throw new Error('Cosmetic slot is invalid.');
    this.requireAccount(accountId);
    const result = this.db.prepare('DELETE FROM equipped_cosmetics WHERE account_id = ? AND slot = ?').run(accountId, slot);
    return { unequipped: result.changes > 0, slot };
  }

  createReport(reporterId, input, now = Math.floor(Date.now() / 1000)) {
    const targetId = input?.targetAccountId;
    const reason = input?.reason;
    if (typeof targetId !== 'string' || targetId.length < 3 || targetId.length > 128) throw new Error('Target account is invalid.');
    if (targetId === reporterId) throw new Error('You cannot report your own account.');
    if (!REPORT_REASONS.has(reason)) throw new Error('Report reason is not supported.');
    const serverId = typeof input.serverId === 'string' ? input.serverId.slice(0, 64) : '';
    const gameMode = typeof input.gameMode === 'string' ? input.gameMode.slice(0, 40) : '';

    return this.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM accounts WHERE account_id = ?').get(targetId))
        throw new Error('Reported account was not found.');
      const duplicate = this.db.prepare(`
        SELECT 1 FROM reports
        WHERE reporter_account_id = ? AND target_account_id = ? AND created_at >= ?
      `).get(reporterId, targetId, now - 3600);
      if (duplicate) throw new Error('You have already reported this player recently.');

      this.db.prepare(`
        INSERT INTO reports(reporter_account_id, target_account_id, reason, created_at, server_id, game_mode)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(reporterId, targetId, reason, now, serverId, gameMode);

      const count = this.db.prepare(`
        SELECT COUNT(DISTINCT reporter_account_id) AS count
        FROM reports WHERE target_account_id = ? AND created_at >= ?
      `).get(targetId, now - 3600).count;
      const urgentReview = count >= 10;
      if (urgentReview) {
        this.db.prepare(`
          INSERT INTO urgent_review_flags(target_account_id, report_count, first_flagged_at, last_updated_at, status)
          VALUES (?, ?, ?, ?, 'urgent_review')
          ON CONFLICT(target_account_id) DO UPDATE SET
            report_count = excluded.report_count,
            last_updated_at = excluded.last_updated_at
        `).run(targetId, count, now, now);
      }
      return { accepted: true, reportsInLastHour: count, urgentReview, automaticBan: false };
    });
  }

  getActiveBan(accountId, now = Math.floor(Date.now() / 1000)) {
    const row = this.db.prepare(`
      SELECT b.id, b.target_account_id AS targetAccountId,
             a.username AS targetUsername, b.issued_by_account_id AS issuedByAccountId,
             issuer.username AS issuedByUsername, b.reason, b.reason_details AS reasonDetails,
             b.duration_key AS durationKey, b.duration_seconds AS durationSeconds,
             b.created_at AS createdAt, b.expires_at AS expiresAt
      FROM ban_records b
      JOIN accounts a ON a.account_id = b.target_account_id
      JOIN accounts issuer ON issuer.account_id = b.issued_by_account_id
      WHERE b.target_account_id = ? AND b.revoked_at IS NULL
        AND (b.expires_at IS NULL OR b.expires_at > ?)
      ORDER BY b.created_at DESC, b.id DESC LIMIT 1
    `).get(accountId, now);
    return row || null;
  }

  getAccessStatus(accountId, now = Math.floor(Date.now() / 1000)) {
    const profile = this.db.prepare('SELECT username FROM accounts WHERE account_id = ?').get(accountId);
    const ban = this.getActiveBan(accountId, now);
    return {
      accountId,
      username: profile?.username ?? '',
      allowed: !ban,
      banned: !!ban,
      ban: ban ? {
        id: ban.id,
        reason: ban.reason,
        reasonDetails: ban.reasonDetails,
        durationKey: ban.durationKey,
        durationSeconds: ban.durationSeconds,
        createdAt: ban.createdAt,
        expiresAt: ban.expiresAt,
        permanent: ban.expiresAt == null,
        appealInstructions: 'Appeal through the PENGUIN VR support channel. Include your username, account ID and ban ID.'
      } : null
    };
  }

  assertOwner(ownerId) {
    if (!this.isGameOwner(ownerId))
      throw Object.assign(new Error('Only the verified game owner can access moderation.'), { statusCode: 403, code: 'owner_required' });
    this.requireAccount(ownerId);
  }

  listOwnerReports(ownerId, limit = 100) {
    this.assertOwner(ownerId);
    const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
    const reports = this.db.prepare(`
      SELECT r.id, r.reporter_account_id AS reporterAccountId, reporter.username AS reporterUsername,
             r.target_account_id AS targetAccountId, target.username AS targetUsername,
             r.reason, r.created_at AS createdAt, r.server_id AS serverId, r.game_mode AS gameMode
      FROM reports r
      JOIN accounts reporter ON reporter.account_id = r.reporter_account_id
      JOIN accounts target ON target.account_id = r.target_account_id
      ORDER BY r.created_at DESC, r.id DESC LIMIT ?
    `).all(safeLimit);
    const urgentReviews = this.db.prepare(`
      SELECT u.target_account_id AS targetAccountId, a.username AS targetUsername,
             u.report_count AS reportCount, u.first_flagged_at AS firstFlaggedAt,
             u.last_updated_at AS lastUpdatedAt, u.status
      FROM urgent_review_flags u JOIN accounts a ON a.account_id = u.target_account_id
      WHERE u.status = 'urgent_review'
      ORDER BY u.last_updated_at DESC LIMIT 100
    `).all();
    return { reports, urgentReviews };
  }

  listOwnerBans(ownerId, limit = 100, now = Math.floor(Date.now() / 1000)) {
    this.assertOwner(ownerId);
    const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
    return this.db.prepare(`
      SELECT b.id, b.target_account_id AS targetAccountId, target.username AS targetUsername,
             b.issued_by_account_id AS issuedByAccountId, issuer.username AS issuedByUsername,
             b.reason, b.reason_details AS reasonDetails, b.duration_key AS durationKey,
             b.duration_seconds AS durationSeconds, b.created_at AS createdAt,
             b.expires_at AS expiresAt, b.revoked_at AS revokedAt,
             b.revoked_by_account_id AS revokedByAccountId, b.revoke_note AS revokeNote,
             CASE WHEN b.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN b.expires_at IS NOT NULL AND b.expires_at <= ? THEN 'expired'
                  ELSE 'active' END AS status
      FROM ban_records b
      JOIN accounts target ON target.account_id = b.target_account_id
      JOIN accounts issuer ON issuer.account_id = b.issued_by_account_id
      ORDER BY b.created_at DESC, b.id DESC LIMIT ?
    `).all(now, safeLimit);
  }

  getOwnerPlayerDetails(ownerId, targetId, now = Math.floor(Date.now() / 1000)) {
    this.assertOwner(ownerId);
    if (typeof targetId !== 'string' || targetId.length < 3 || targetId.length > 128)
      throw new Error('Target account identifier is invalid.');
    const account = this.db.prepare(`
      SELECT account_id AS accountId, username, colour_hex AS colourHex, level, xp,
             wins, losses, playtime_seconds AS playtimeSeconds, created_at AS createdAt
      FROM accounts WHERE account_id = ?
    `).get(targetId);
    if (!account) throw new Error('Player account was not found.');
    const reports = this.db.prepare(`
      SELECT r.id, r.reporter_account_id AS reporterAccountId, reporter.username AS reporterUsername,
             r.reason, r.created_at AS createdAt, r.server_id AS serverId, r.game_mode AS gameMode
      FROM reports r JOIN accounts reporter ON reporter.account_id = r.reporter_account_id
      WHERE r.target_account_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 100
    `).all(targetId);
    const bans = this.db.prepare(`
      SELECT id, reason, reason_details AS reasonDetails, duration_key AS durationKey,
             duration_seconds AS durationSeconds, created_at AS createdAt, expires_at AS expiresAt,
             revoked_at AS revokedAt,
             CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
                  WHEN expires_at IS NOT NULL AND expires_at <= ? THEN 'expired'
                  ELSE 'active' END AS status
      FROM ban_records WHERE target_account_id = ? ORDER BY created_at DESC, id DESC LIMIT 100
    `).all(now, targetId);
    return { account, reports, bans, activeBan: this.getActiveBan(targetId, now) };
  }

  issueBan(ownerId, input, now = Math.floor(Date.now() / 1000)) {
    this.assertOwner(ownerId);
    const targetId = input?.targetAccountId;
    const reason = input?.reason;
    const durationKey = input?.duration;
    const reasonDetails = typeof input?.reasonDetails === 'string' ? input.reasonDetails.trim().slice(0, 240) : '';
    if (typeof targetId !== 'string' || targetId.length < 3 || targetId.length > 128)
      throw new Error('Target account identifier is invalid.');
    if (targetId === ownerId) throw new Error('The game owner cannot ban their own account.');
    if (!REPORT_REASONS.has(reason)) throw new Error('Ban reason is not supported.');
    const standardDurations = new Map([
      ['10m', 600], ['1h', 3600], ['24h', 86400], ['7d', 604800], ['30d', 2592000]
    ]);
    let durationSeconds;
    if (durationKey === 'permanent') durationSeconds = null;
    else if (durationKey === 'custom') {
      const custom = Number(input?.customSeconds);
      if (!Number.isSafeInteger(custom) || custom < 60 || custom > 31_536_000)
        throw new Error('Custom ban duration must be between 60 seconds and 365 days.');
      durationSeconds = custom;
    } else if (standardDurations.has(durationKey)) durationSeconds = standardDurations.get(durationKey);
    else throw new Error('Ban duration is not supported.');

    this.requireAccount(targetId);
    return this.transaction(() => {
      // Replace any currently active ban while retaining its full audit history.
      this.db.prepare(`UPDATE ban_records SET revoked_at = ?, revoked_by_account_id = ?, revoke_note = 'superseded by a new owner ban'
        WHERE target_account_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`)
        .run(now, ownerId, targetId, now);
      const expiresAt = durationSeconds == null ? null : now + durationSeconds;
      const inserted = this.db.prepare(`
        INSERT INTO ban_records(target_account_id, issued_by_account_id, reason, reason_details,
          duration_key, duration_seconds, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(targetId, ownerId, reason, reasonDetails, durationKey, durationSeconds, now, expiresAt);
      return {
        issued: true,
        banId: Number(inserted.lastInsertRowid),
        targetAccountId: targetId,
        reason,
        reasonDetails,
        durationKey,
        durationSeconds,
        createdAt: now,
        expiresAt,
        permanent: expiresAt == null,
        disconnected: false,
        disconnectNote: 'The backend ban is active. The session host must remove the player; a client-hosted Relay host cannot be remotely forced to disconnect by this API.'
      };
    });
  }

  revokeBan(ownerId, banId, note = '', now = Math.floor(Date.now() / 1000)) {
    this.assertOwner(ownerId);
    const id = Number.parseInt(banId, 10);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Ban identifier is invalid.');
    const result = this.db.prepare(`
      UPDATE ban_records SET revoked_at = ?, revoked_by_account_id = ?, revoke_note = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(now, ownerId, typeof note === 'string' ? note.trim().slice(0, 240) : '', id);
    if (result.changes === 0) throw new Error('Active ban was not found.');
    return { revoked: true, banId: id, revokedAt: now };
  }

  getLeaderboard(limit = 50) {
    const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 50));
    return this.db.prepare(`
      SELECT username, colour_hex AS colourHex, level, xp, wins, penguin_bucks AS penguinBucks
      FROM accounts ORDER BY wins DESC, xp DESC LIMIT ?
    `).all(safeLimit);
  }

  listFriends(accountId, limit = 100) {
    this.requireAccount(accountId);
    const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 100));
    return this.db.prepare(`
      SELECT a.account_id AS accountId, a.username, a.colour_hex AS colourHex,
             a.level, a.wins, f.created_at AS friendsSince
      FROM friendships f
      JOIN accounts a ON a.account_id = CASE
        WHEN f.account_a = ? THEN f.account_b ELSE f.account_a END
      WHERE f.account_a = ? OR f.account_b = ?
      ORDER BY a.username COLLATE NOCASE
      LIMIT ?
    `).all(accountId, accountId, accountId, safeLimit);
  }

  listFriendRequests(accountId, limit = 50) {
    this.requireAccount(accountId);
    const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 50));
    const incoming = this.db.prepare(`
      SELECT r.id AS requestId, a.account_id AS accountId, a.username, a.colour_hex AS colourHex,
             a.level, r.created_at AS createdAt
      FROM friend_requests r JOIN accounts a ON a.account_id = r.requester_account_id
      WHERE r.target_account_id = ? AND r.status = 'pending'
      ORDER BY r.created_at DESC LIMIT ?
    `).all(accountId, safeLimit);
    const outgoing = this.db.prepare(`
      SELECT r.id AS requestId, a.account_id AS accountId, a.username, a.colour_hex AS colourHex,
             a.level, r.created_at AS createdAt
      FROM friend_requests r JOIN accounts a ON a.account_id = r.target_account_id
      WHERE r.requester_account_id = ? AND r.status = 'pending'
      ORDER BY r.created_at DESC LIMIT ?
    `).all(accountId, safeLimit);
    return { incoming, outgoing };
  }

  sendFriendRequest(requesterId, targetId, now = Math.floor(Date.now() / 1000)) {
    if (typeof targetId !== 'string' || targetId.length < 3 || targetId.length > 128)
      throw new Error('Target account identifier is invalid.');
    if (requesterId === targetId) throw new Error('You cannot add your own account as a friend.');
    this.requireAccount(requesterId);
    this.requireAccount(targetId);
    const [accountA, accountB] = [requesterId, targetId].sort();

    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM friendships WHERE account_a = ? AND account_b = ?').get(accountA, accountB))
        throw new Error('You are already friends with this player.');

      const reversePending = this.db.prepare(`
        SELECT id FROM friend_requests
        WHERE requester_account_id = ? AND target_account_id = ? AND status = 'pending'
      `).get(targetId, requesterId);
      if (reversePending) throw new Error('This player has already sent you a request. Accept their incoming request.');

      const existing = this.db.prepare(`
        SELECT id, status FROM friend_requests WHERE requester_account_id = ? AND target_account_id = ?
      `).get(requesterId, targetId);
      if (existing?.status === 'pending') throw new Error('Friend request already sent.');
      if (existing?.status === 'accepted') throw new Error('You are already friends with this player.');

      if (existing) {
        this.db.prepare(`UPDATE friend_requests SET status = 'pending', created_at = ?, updated_at = ? WHERE id = ?`)
          .run(now, now, existing.id);
        return { accepted: true, requestId: existing.id, status: 'pending' };
      }
      const result = this.db.prepare(`
        INSERT INTO friend_requests(requester_account_id, target_account_id, status, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, ?)
      `).run(requesterId, targetId, now, now);
      return { accepted: true, requestId: Number(result.lastInsertRowid), status: 'pending' };
    });
  }

  respondToFriendRequest(accountId, requestId, accept, now = Math.floor(Date.now() / 1000)) {
    const parsedId = Number.parseInt(requestId, 10);
    if (!Number.isSafeInteger(parsedId) || parsedId < 1) throw new Error('Friend request identifier is invalid.');
    this.requireAccount(accountId);
    return this.transaction(() => {
      const request = this.db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(parsedId);
      if (!request || request.target_account_id !== accountId)
        throw new Error('Incoming friend request was not found.');
      if (request.status !== 'pending') throw new Error('Friend request is no longer pending.');

      if (!accept) {
        this.db.prepare(`UPDATE friend_requests SET status = 'declined', updated_at = ? WHERE id = ?`)
          .run(now, parsedId);
        return { accepted: true, status: 'declined', requestId: parsedId };
      }

      const [accountA, accountB] = [request.requester_account_id, request.target_account_id].sort();
      this.db.prepare(`INSERT OR IGNORE INTO friendships(account_a, account_b, created_at) VALUES (?, ?, ?)`)
        .run(accountA, accountB, now);
      this.db.prepare(`UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?`)
        .run(now, parsedId);
      return { accepted: true, status: 'accepted', requestId: parsedId };
    });
  }

  removeFriend(accountId, targetId) {
    if (typeof targetId !== 'string' || targetId.length < 3 || targetId.length > 128)
      throw new Error('Target account identifier is invalid.');
    if (accountId === targetId) throw new Error('Invalid friend account.');
    this.requireAccount(accountId);
    const [accountA, accountB] = [accountId, targetId].sort();
    this.transaction(() => {
      const result = this.db.prepare('DELETE FROM friendships WHERE account_a = ? AND account_b = ?')
        .run(accountA, accountB);
      if (result.changes === 0) throw new Error('Friend was not found.');
      this.db.prepare(`
        UPDATE friend_requests SET status = 'declined'
        WHERE status = 'accepted' AND (
          (requester_account_id = ? AND target_account_id = ?) OR
          (requester_account_id = ? AND target_account_id = ?)
        )
      `).run(accountId, targetId, targetId, accountId);
    });
    return { removed: true, accountId: targetId };
  }

  recordRecentPlayer(viewerId, targetId, serverId = '', now = Math.floor(Date.now() / 1000)) {
    if (typeof targetId !== 'string' || targetId.length < 3 || targetId.length > 128)
      throw new Error('Target account identifier is invalid.');
    if (viewerId === targetId) throw new Error('You cannot add yourself to recent players.');
    this.requireAccount(viewerId);
    this.requireAccount(targetId);
    const safeServerId = typeof serverId === 'string' ? serverId.slice(0, 96) : '';
    this.db.prepare(`
      INSERT INTO recent_players(viewer_account_id, target_account_id, last_seen_at, encounter_count, last_server_id)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(viewer_account_id, target_account_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        encounter_count = recent_players.encounter_count + 1,
        last_server_id = excluded.last_server_id
    `).run(viewerId, targetId, now, safeServerId);
    return { recorded: true, accountId: targetId, lastSeenAt: now };
  }

  listRecentPlayers(accountId, limit = 25) {
    this.requireAccount(accountId);
    const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 25));
    return this.db.prepare(`
      SELECT a.account_id AS accountId, a.username, a.colour_hex AS colourHex,
             a.level, r.last_seen_at AS lastSeenAt,
             r.encounter_count AS encounterCount, r.last_server_id AS lastServerId
      FROM recent_players r JOIN accounts a ON a.account_id = r.target_account_id
      WHERE r.viewer_account_id = ?
      ORDER BY r.last_seen_at DESC LIMIT ?
    `).all(accountId, safeLimit);
  }

  requireAccount(accountId) {
    if (!this.db.prepare('SELECT 1 FROM accounts WHERE account_id = ?').get(accountId))
      throw new Error('Account has not been created yet.');
  }

  toProfile(row) {
    const owner = this.getGameOwner();
    return {
      accountId: row.account_id,
      username: row.username,
      colourHex: row.colour_hex,
      level: row.level,
      xp: row.xp,
      wins: row.wins,
      losses: row.losses,
      playtimeSeconds: row.playtime_seconds,
      penguinBucks: row.penguin_bucks,
      lastDailyClaimAt: row.last_daily_claim_at,
      isOwner: owner?.accountId === row.account_id,
      ownerClaimedAt: owner?.claimedAt ?? 0
    };
  }

  normalisePreferences(value) {
    return {
      mutedAccountIds: Array.isArray(value.mutedAccountIds) ? value.mutedAccountIds : [],
      voiceEnabled: value.voiceEnabled !== false,
      pushToTalk: value.pushToTalk === true,
      microphoneVolume: clampNumber(value.microphoneVolume, 0, 1, 1),
      playerVolume: clampNumber(value.playerVolume, 0, 1, 1),
      musicVolume: clampNumber(value.musicVolume, 0, 1, 0.7),
      leftHanded: value.leftHanded === true,
      graphicsQuality: Math.round(clampNumber(value.graphicsQuality, 0, 2, 1))
    };
  }
}
