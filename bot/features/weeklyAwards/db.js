const { setTimeout } = require('node:timers/promises');
const dayjs = require('../../lib/dayjsSetup');
const { isUrl } = require('../../lib/util');
const { fromNumber } = require('./weekday');

const db = require('better-sqlite3')('weeklyAward.db');

class WeeklyAward {
  #TABLE = 'reacted_messages';

  /** @type {WeeklyAwardConfig} */
  #config;
  /** @type {WeeklyAwardTime} */
  #times;

  /** @type {(row: unknown) => row is WeeklyAwardDatabaseRow} */
  static #isRow(row) {
    if (row == null || typeof row !== 'object') return false;

    if (!('guild_id' in row && typeof row.guild_id === 'string')) return false;
    if (!('channel_id' in row && typeof row.channel_id === 'string')) return false;
    if (!('message_id' in row && typeof row.message_id === 'string')) return false;
    if (!('guild_name' in row && typeof row.guild_name === 'string')) return false;
    if (!('channel_name' in row && typeof row.channel_name === 'string')) return false;
    if (!('content' in row && typeof row.content === 'string')) return false;
    if (!('author' in row && typeof row.author === 'string')) return false;
    if (!('url' in row && typeof row.url === 'string' && isUrl(row.url))) return false;
    if (!('reactions_count' in row && typeof row.reactions_count === 'number')) return false;
    if (!('timestamp' in row && typeof row.timestamp === 'string')) return false;
    if (!('created_at' in row && typeof row.created_at === 'string')) return false;
    if (!('updated_at' in row && typeof row.updated_at === 'string')) return false;

    return true;
  }

  get config() {
    return this.#config;
  }

  get times() {
    return this.#times;
  }

  constructor() {
    db.pragma('auto_vacuum = incremental');
    db.prepare(`
      create table if not exists ${this.#TABLE} (
        guild_id text not null,
        channel_id text not null,
        message_id text not null,
        guild_name text not null,
        channel_name text not null,
        content text not null,
        author text not null,
        url text not null,
        reactions_count integer not null,
        timestamp text not null,
        created_at text not null default (datetime('now')),
        updated_at text not null default (datetime('now')),
        primary key (guild_id, channel_id, message_id)
      )
    `).run();

    this.#config = new WeeklyAwardConfig();
    this.#times = new WeeklyAwardTime();
  }

  /**
   * @param {string} guildId
   * @param {string} channelId
   * @param {string} messageId
   * @returns {WeeklyAwardRecord?}
   */
  get(guildId, channelId, messageId) {
    const stmt = db.prepare(`
      select *
      from ${this.#TABLE}
      where
        guild_id   = @guildId   and
        channel_id = @channelId and
        message_id = @messageId
    `);

    const row = stmt.get({ guildId, channelId, messageId });
    if (!WeeklyAward.#isRow(row)) return null;

    return {
      guildId,
      channelId,
      messageId,
      guildName: row.guild_name,
      channelName: row.channel_name,
      content: row.content,
      author: row.author,
      url: row.url,
      reactionsCount: row.reactions_count,
      timestamp: dayjs.utc(row.timestamp).tz(),
      createdAt: dayjs.utc(row.created_at).tz(),
      updatedAt: dayjs.utc(row.updated_at).tz(),
    };
  }

  /**
   * @param {Message<true>} message
   * @param {number} reactionsCount
   * @returns {Promise<void>}
   */
  async set(message, reactionsCount) {
    const stmt = db.prepare(`
      insert into ${this.#TABLE} (
        guild_id,
        channel_id,
        message_id,
        guild_name,
        channel_name,
        content,
        author,
        url,
        reactions_count,
        timestamp
      ) values (
        @guildId,
        @channelId,
        @messageId,
        @guildName,
        @channelName,
        @content,
        @author,
        @url,
        @reactionsCount,
        @timestamp
      )
      on conflict (guild_id, channel_id, message_id) do
        update set
          guild_name = @guildName,
          channel_name = @channelName,
          content = @content,
          author = @author,
          reactions_count = @reactionsCount,
          updated_at = datetime('now')
    `);

    const { channel } = message;
    const channelName = 'name' in channel ? channel.name : '';

    try {
      stmt.run({
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        guildName: message.guild?.name ?? '',
        channelName,
        content: message.content,
        author: message.author?.username ?? '',
        url: message.url,
        reactionsCount,
        timestamp: dayjs(message.createdTimestamp).utc().toISOString(),
      });
    }
    catch (e) {
      if (e instanceof TypeError && e.message.includes('database connection is busy')) {
        await setTimeout();
        return this.set(message, reactionsCount);
      }
      throw e;
    }
  }

  /** @returns {WeeklyAwardRecord[]} */
  all() {
    const stmt = db.prepare(`select * from ${this.#TABLE}`);

    return stmt.all()
      .filter(WeeklyAward.#isRow)
      .map(row => ({
        guildId: row.guild_id,
        channelId: row.channel_id,
        messageId: row.message_id,
        guildName: row.guild_name,
        channelName: row.channel_name,
        content: row.content,
        author: row.author,
        url: row.url,
        reactionsCount: row.reactions_count,
        timestamp: dayjs.utc(row.timestamp).tz(),
        createdAt: dayjs.utc(row.created_at).tz(),
        updatedAt: dayjs.utc(row.updated_at).tz(),
      }));
  }

  /**
   * @returns {Generator<WeeklyAwardRecord>}
   */
  *iterate() {
    const stmt = db.prepare(`select * from ${this.#TABLE}`);

    for (const row of stmt.iterate()) {
      if (!WeeklyAward.#isRow(row)) continue;

      yield {
        guildId: row.guild_id,
        channelId: row.channel_id,
        messageId: row.message_id,
        guildName: row.guild_name,
        channelName: row.channel_name,
        content: row.content,
        author: row.author,
        url: row.url,
        reactionsCount: row.reactions_count,
        timestamp: dayjs.utc(row.timestamp).tz(),
        createdAt: dayjs.utc(row.created_at).tz(),
        updatedAt: dayjs.utc(row.updated_at).tz(),
      };
    }
  }

  /**
   * @param {T[]} values
   * @param {function(T): void} callback
   * @returns {Promise<void>}
   * @template T
   */
  async transaction(values, callback) {
    /** @type {Transaction<(values: T[]) => void>} */
    const fn = db.transaction(values => values.forEach(callback));

    try {
      fn(values);
    }
    catch (e) {
      if (e instanceof TypeError && e.message.includes('database connection is busy')) {
        await setTimeout();
        return this.transaction(values, callback);
      }
      throw e;
    }
  }

  /**
   * @param {string} guildId
   * @param {string} channelId
   * @param {string} messageId
   * @returns {Promise<void>}
   */
  async delete(guildId, channelId, messageId) {
    const stmt = db.prepare(`
      delete from ${this.#TABLE}
      where
        guild_id   = @guildId   and
        channel_id = @channelId and
        message_id = @messageId
    `);

    try {
      stmt.run({ guildId, channelId, messageId });
    }
    catch (e) {
      if (e instanceof TypeError && e.message.includes('database connection is busy')) {
        await setTimeout();
        return this.delete(guildId, channelId, messageId);
      }
      throw e;
    }
  }

  /**
   * @param {string} guildId
   * @param {number} days
   * @returns {AsyncGenerator<number | void>}
   */
  async *deleteOutdated(guildId, days) {
    const whereStatement = `
      where
        guild_id = @guildId and
        julianday('now') - julianday(timestamp) > @days
    `;
    const cntStmt = db.prepare(`select count(*) from ${this.#TABLE} ${whereStatement}`).pluck();
    const delStmt = db.prepare(`delete from ${this.#TABLE} ${whereStatement}`);

    try {
      // return outdated records count
      const count = cntStmt.get({ guildId, days });

      if (typeof count === 'number') {
        yield count;
      }
      else {
        throw new TypeError('count must be a number');
      }

      if (count > 0) {
        delStmt.run({ guildId, days });
        yield;
      }
    }
    catch (e) {
      if (e instanceof TypeError && e.message.includes('database connection is busy')) {
        await setTimeout();
        return yield* this.deleteOutdated(guildId, days);
      }
      throw e;
    }
  }

  vacuum() {
    db.pragma('incremental_vacuum');
  }
}

class WeeklyAwardConfig {
  #TABLE = 'post_target';

  /** @type {(row: unknown) => row is WeeklyAwardConfigRow} */
  static #isRow(row) {
    if (row == null || typeof row !== 'object') return false;

    if (!('guild_id' in row && typeof row.guild_id === 'string')) return false;
    if (!('guild_name' in row && typeof row.guild_name === 'string')) return false;
    if (!('channel_id' in row && typeof row.channel_id === 'string')) return false;
    if (!('channel_name' in row && typeof row.channel_name === 'string')) return false;
    if (!('created_at' in row && typeof row.created_at === 'string')) return false;
    if (!('updated_at' in row && typeof row.updated_at === 'string')) return false;

    return true;
  }

  /** @type {WeeklyAwardConfigRecord[]} */
  get records() {
    const stmt = db.prepare(`select * from ${this.#TABLE}`);

    const rows = stmt.all();
    return rows
      .filter(WeeklyAwardConfig.#isRow)
      .map(row => ({
        guildId: row.guild_id,
        guildName: row.guild_name,
        channelId: row.channel_id,
        channelName: row.channel_name,
        createdAt: dayjs.utc(row.created_at).tz(),
        updatedAt: dayjs.utc(row.updated_at).tz(),
      }));
  }

  constructor() {
    db.prepare(`
      create table if not exists ${this.#TABLE} (
        guild_id text not null primary key,
        guild_name text not null,
        channel_id text not null,
        channel_name text not null,
        created_at text not null default (datetime('now')),
        updated_at text not null default (datetime('now'))
      )
    `).run();
  }

  /**
   * @param {string} guildId
   * @param {string} guildName
   * @param {string} channelId
   * @param {string} channelName
   * @returns {Promise<void>}
   */
  async register(guildId, guildName, channelId, channelName) {
    const stmt = db.prepare(`
      insert into ${this.#TABLE} (
        guild_id,
        guild_name,
        channel_id,
        channel_name
      ) values (
        @guildId,
        @guildName,
        @channelId,
        @channelName
      )
      on conflict (guild_id) do
        update set
          guild_name = @guildName,
          channel_id = @channelId,
          channel_name = @channelName,
          updated_at = datetime('now')
    `);

    try {
      stmt.run({ guildId, guildName, channelId, channelName });
    }
    catch (e) {
      if (e instanceof TypeError && e.message.includes('database connection is busy')) {
        await setTimeout();
        return this.register(guildId, guildName, channelId, channelName);
      }
      throw e;
    }
  }

  /**
   * @param {string} guildId
   * @returns {Promise<void>}
   */
  async unregister(guildId) {
    const stmt = db.prepare(`
      delete from ${this.#TABLE}
      where
        guild_id = ?
    `);

    try {
      stmt.run(guildId);
    }
    catch (e) {
      if (e instanceof TypeError && e.message.includes('database connection is busy')) {
        await setTimeout();
        return this.unregister(guildId);
      }
      throw e;
    }
  }

  /**
   * @param {string} guildId
   * @returns {WeeklyAwardConfigRecord?}
   */
  get(guildId) {
    const stmt = db.prepare(`
      select *
      from ${this.#TABLE}
      where
        guild_id = ?
    `);

    const row = stmt.get(guildId);
    if (!WeeklyAwardConfig.#isRow(row)) return null;

    return {
      guildId: row.guild_id,
      guildName: row.guild_name,
      channelId: row.channel_id,
      channelName: row.channel_name,
      createdAt: dayjs.utc(row.created_at).tz(),
      updatedAt: dayjs.utc(row.updated_at).tz(),
    };
  }
}

class WeeklyAwardTime {
  #TABLE = 'times';

  /** @type {(row: unknown) => row is WeeklyAwardTimeRow} */
  static #isRow(row) {
    if (row == null || typeof row !== 'object') return false;

    if (!('guild_id' in row && typeof row.guild_id === 'string')) return false;
    if (!('weekday' in row && typeof row.weekday === 'number')) return false;
    if (!('hour' in row && typeof row.hour === 'number')) return false;
    if (!('minute' in row && typeof row.minute === 'number')) return false;
    if (!('created_at' in row && typeof row.created_at === 'string')) return false;
    if (!('updated_at' in row && typeof row.updated_at === 'string')) return false;

    return true;
  }

  constructor() {
    db.prepare(`
      create table if not exists ${this.#TABLE} (
        guild_id text not null primary key,
        weekday integer not null,
        hour integer not null,
        minute integer not null,
        created_at text not null default (datetime('now')),
        updated_at text not null default (datetime('now'))
      )
    `).run();
  }

  /**
   * @param {string} guildId
   * @param {Weekday} weekday
   * @param {number} hour
   * @param {number} minute
   * @returns {Promise<void>}
   */
  async set(guildId, weekday, hour, minute) {
    const stmt = db.prepare(`
      insert into ${this.#TABLE} (
        guild_id,
        weekday,
        hour,
        minute
      ) values (
        @guildId,
        @weekday,
        @hour,
        @minute
      )
      on conflict (guild_id) do
        update set
          weekday = @weekday,
          hour = @hour,
          minute = @minute,
          updated_at = datetime('now')
    `);

    try {
      stmt.run({ guildId, weekday, hour, minute });
    }
    catch (e) {
      if (e instanceof TypeError && e.message.includes('database connection is busy')) {
        await setTimeout();
        return this.set(guildId, weekday, hour, minute);
      }
      throw e;
    }
  }

  /**
   * @param {string} guildId
   * @returns {Promise<void>}
   */
  async delete(guildId) {
    const stmt = db.prepare(`
      delete from ${this.#TABLE}
      where
        guild_id = ?
    `);

    try {
      stmt.run(guildId);
    }
    catch (e) {
      if (e instanceof TypeError && e.message.includes('database connection is busy')) {
        await setTimeout();
        return this.delete(guildId);
      }
      throw e;
    }
  }

  /**
   * @param {string} guildId
   * @returns {WeeklyAwardTimeRecord?}
   */
  get(guildId) {
    const stmt = db.prepare(`
      select *
      from ${this.#TABLE}
      where
        guild_id = ?
    `);

    const row = stmt.get(guildId);
    if (!WeeklyAwardTime.#isRow(row)) return null;

    return {
      guildId: row.guild_id,
      weekday: fromNumber(row.weekday),
      hour: row.hour,
      minute: row.minute,
      createdAt: dayjs.utc(row.created_at).tz(),
      updatedAt: dayjs.utc(row.updated_at).tz(),
    };
  }
}

exports.db = new WeeklyAward();
