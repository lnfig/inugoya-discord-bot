const { Events, ChannelType } = require('discord.js');
const dayjs = require('../../lib/dayjsSetup');
const client = require('../../client');
const { log } = require('../../lib/log');
const { fetchMessageByIds, messageToEmbeds } = require('../util');
const { db } = require('./db');

/**
 * @type {Map<string, NodeJS.Timeout>}
 * key is Guild ID, value is Timeout ID
 */
const instances = new Map();

client.once(Events.ClientReady, async () => {
  for (const { guildId } of db.config.records) {
    startAward(guildId);
  }

  log('weekly award is ready.');
});
client.on(Events.GuildDelete, async guild => {
  await stopAward(guild.id);
  await db.config.unregister(guild.id);
});
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  const message = await reaction.message.fetch();
  const { author, reactions } = message;

  if (author.bot || !message.inGuild()) return;

  // do not record reactions count if message reacted is posted to not registered server
  if (db.config.get(message.guildId) == null) return;

  const reactionsCount = reactions.cache.reduce((acc, reaction) => acc + reaction.count, 0);
  await db.set(message, reactionsCount);
});
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  const message = await reaction.message.fetch();
  const { author, reactions } = message;

  if (author.bot || !message.inGuild()) return;

  const reactionsCount = reactions.cache.reduce((acc, reaction) => acc + reaction.count, 0);
  if (reactionsCount > 0) {
    await db.set(message, reactionsCount);
  }
  else {
    await db.delete(message.guildId, message.channelId, message.id);
  }
});

/**
 * @param {string} guildId
 * @param {string} guildName
 * @param {string} channelName
 * @param {Weekday} weekday
 * @param {number} hour
 * @param {number} minute
 * @returns {Promise<void>}
 */
const tick = async (guildId, guildName, channelName, weekday, hour, minute) => {
  const { isNonEmpty } = await import('ts-array-length');

  const now = dayjs().tz();

  if (now.day() === weekday && now.hour() === hour && now.minute() === minute) {
    log(guildName, 'WeeklyAward: report initiated');

    const guilds = await client.guilds.fetch();
    const guild = await guilds.find(guild => guild.name === guildName)?.fetch();
    const channel = guild?.channels?.cache?.find(channel => channel.name === channelName);

    if (channel?.type === ChannelType.GuildText) {
      // remove messages sent over a week ago
      for await (const count of db.deleteOutdated(guildId, 7)) {
        if (typeof count === 'number') {
          log(guildName, `WeeklyAward: outdated records [${count}]`);
        }
        else {
          db.vacuum();
          log(guildName, `WeeklyAward: records deleted`);
        }
      }

      if (db.all().some(({ reactionsCount: count }) => count > 0)) {
        /**
         * @param {WeeklyAwardRecord} record
         * @returns {Promise<MessageAndReactions?>}
         */
        const fetchesMessage = async record => {
          if (record.guildId !== guildId) return null;

          const message = await fetchMessageByIds(guildId, record.channelId, record.messageId);
          return message != null ? { message, reactionsCount: record.reactionsCount } : null;
        };
        const fetchingPromises = [];

        // collect messages posted in current guild
        for (const record of db.iterate()) {
          fetchingPromises.push(fetchesMessage(record));
        }

        const messages = (await Promise.all(fetchingPromises))
          .filter(/** @type {(x: MessageAndReactions?) => x is MessageAndReactions} */ x => x != null);

        // tally messages by reactions count
        const talliedMessages = messages
          .reduce((/** @type {{ [count: number]: Message<true>[] }} */ acc, { message, reactionsCount }) =>
            ({ ...acc, [reactionsCount]: [...acc[reactionsCount] ?? [], message] }), {});
        // sort descending order by reactions count
        const messagesArray = Object.entries(talliedMessages).sort(([a, ], [b, ]) => (+b) - (+a));

        /** @type {{ title: string, embeds: APIEmbed[] }[]} */
        const contents = [];
        {
          let rank = 1;

          // take 3 elements
          for (const [count, messages] of messagesArray.filter((_, i) => i < Math.min(messagesArray.length, 3))) {
            const rankText = rank === 1 ? '最も' : ` ${rank}番目に`;

            /** @type {APIEmbed[]} */
            const embeds = [];

            for (const message of messages) {
              embeds.push(...await messageToEmbeds(message, false));
            }
            contents.push({
              title: `**先週${rankText}リアクションが多かった投稿${messages.length >= 2 ? 'たち' : ''}です！！** [${count}個]`,
              embeds,
            });
            rank += messages.length;
          }
        }

        if (isNonEmpty(contents)) {
          const [{ title, embeds }, ...restContents] = contents;
          const firstMessage = await channel.send({ content: `**【リアクション大賞】**\n${title}`, embeds });

          if (restContents.length > 0) {
            const thread = await firstMessage.startThread({ name: 'リアクション大賞全体' });

            for (const { title, embeds } of restContents) {
              await thread.send({ content: title, embeds });
            }
          }
        }
      }
      else {
        await channel.send('【リアクション大賞】\n先週はリアクションが付いた投稿はありませんでした！！');
      }
    }

    log(guildName, 'WeeklyAward: report finished');

    // run again almost next week.
    const timeout = setTimeout(() => tick(guildId, guildName, channelName, weekday, hour, minute), 86400 * 1000 * 6.9);
    instances.set(guildId, timeout);
  }
  // or else, after 1 sec.
  else {
    const timeout = setTimeout(() => tick(guildId, guildName, channelName, weekday, hour, minute), 1000);
    instances.set(guildId, timeout);
  }
};

/**
 * @param {string} guildId
 * @returns {Promise<void>}
 */
const startAward = async guildId => {
  const configRecord = db.config.get(guildId);
  const timeRecord = db.times.get(guildId);
  if (configRecord == null || timeRecord == null) {
    return log(`startAward: ${{ guildId }} is not registered.`);
  }

  const { guildName, channelName, createdAt, updatedAt } = configRecord;
  const { weekday, hour, minute } = timeRecord;
  log('startAward:', {
    ...configRecord,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  });

  if (instances.has(guildId)) {
    await stopAward(guildId);
  }
  return tick(guildId, guildName, channelName, weekday, hour, minute);
};

/**
 * @param {string} guildId
 * @returns {Promise<void>}
 */
const stopAward = async guildId => {
  const configRecord = db.config.get(guildId);
  if (configRecord == null) {
    return await log(`stopAward: ${{ guildId }} is not registered.`);
  }

  const { createdAt, updatedAt } = configRecord;
  await log('stopAward:', {
    ...configRecord,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  });

  if (instances.has(guildId)) {
    clearTimeout(instances.get(guildId));
  }
};

module.exports = {
  startAward,
  stopAward,
};
