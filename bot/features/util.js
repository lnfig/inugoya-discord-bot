const { EmbedBuilder } = require('discord.js');
const fastAvgColor = require('fast-average-color-node');
const client = require('../client');
const { log } = require('../lib/log');

/**
 * @param {string} guildId
 * @param {string} channelId
 * @param {string} messageId
 * @returns {Promise<Message<true>?>}
 */
const fetchMessageByIds = async (guildId, channelId, messageId) => {
  try {
    const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId);
    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId);

    if (channel?.isTextBased() &&!channel.isVoiceBased()) {
      return channel.messages.cache.get(messageId) ?? await channel.messages.fetch(messageId);
    }
    return null;
  }
  catch (e) {
    if (e instanceof Error) {
      const argDetails = `guildId: ${guildId}, channelId: ${channelId}, messageId: ${messageId}`;
      if (e.stack != null) {
        const [firstLine, ...rest] = e.stack.split('\n');
        log(`${fetchMessageByIds.name}:`, [`${firstLine} [${argDetails}]`, ...rest].join('\n'));
      }
      else {
        log(`${fetchMessageByIds.name}:`, `${e.name}: ${e.message} [${argDetails}]`);
      }
      return null;
    }
    else {
      throw e;
    }
  }
};

/**
 * @param {Message<boolean>} message
 * @param {boolean=} [addReactionField=true]
 * @returns {Promise<APIEmbed[]>}
 */
const messageToEmbeds = async (message, addReactionField = true) => {
  const { isNonEmpty } = await import('ts-array-length');
  const { channel } = message;

  if (channel.isTextBased()) {

    /** @type {APIEmbed[]} */
    const embeds = [];

    const author = await message.author?.fetch();

    /** @type {(avatarUrl: string | null | undefined) => Promise<number | null>} */
    const getAverageColor = async avatarUrl => {
      if (avatarUrl == null) return null;

      const { value: [red, green, blue] } = await fastAvgColor.getAverageColor(avatarUrl, { silent: true });
      return (red << 16) + (green << 8) + blue;
    };

    const embed = new EmbedBuilder()
      .setURL(message.url)
      .setTimestamp(message.editedTimestamp ?? message.createdTimestamp)
      .setColor(author?.accentColor ?? await getAverageColor(author?.avatarURL()));

    if (author != null) {
      embed.setAuthor({ name: author.username, url: message.url, iconURL: author.displayAvatarURL() });
    }

    if (message.content !== '') {
      embed.setDescription(message.content);
    }

    if (addReactionField) {
      const reactions = message.reactions.cache;
      const reactionsCount = reactions.reduce((acc, x) => acc + x.count, 0);

      if (reactionsCount > 0) {
        embed.addFields({ name: 'Reactions', value: String(reactionsCount) });
      }
    }

    const [attachments, spoilerAttachments] = message.attachments.partition(x => !x.spoiler);

    if (spoilerAttachments.size > 0) {
      embed.addFields({ name: 'Spoilers', value: String(spoilerAttachments.size) });
    }

    if (!channel.isDMBased()) {
      const text = channel.name;
      const iconURL = message.guild?.iconURL();

      if (iconURL != null) {
        embed.setFooter({ text, iconURL });
      }
      else {
        embed.setFooter({ text });
      }
    }

    /**
     * @param {import('discord.js').Attachment} attachment
     * @returns {'image' | 'video'}
     */
    const getEmbedMediaType = attachment => {
      const [type] = attachment.contentType?.split('/') ?? [];
      return type === 'video' ? 'video' : 'image';
    };

    const attachmentArray = attachments.toJSON();
    if (isNonEmpty(attachmentArray)) {
      const attachment = attachmentArray[0];
      const { url } = attachment;

      embeds.push({ ...embed.toJSON(), [getEmbedMediaType(attachment)]: { url } });
    }
    else {
      embeds.push(embed.toJSON());
    }

    for (const attachment of attachmentArray.slice(1)) {
      const { url } = attachment;

      embeds.push({ url: message.url, [getEmbedMediaType(attachment)]: { url } });
    }

    return embeds;
  }
  else {
    return [];
  }
};

module.exports = {
  fetchMessageByIds,
  messageToEmbeds,
};
