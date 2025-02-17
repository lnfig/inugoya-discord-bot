const { ApplicationCommandOptionType } = require('discord.js');
const { toEmojis } = require('.');

/** @type {ChatInputCommand<void>} */
module.exports = {
  emojify: {
    description: 'アルファベット絵文字で連続リアクションします。',
    options: [
      {
        name: 'to',
        description: 'リアクションを送るメッセージのID',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: 'text',
        description: '与えるリアクションのアルファベット文字列',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
    async func(interaction) {
      const to = interaction.options.getString('to', true);
      const text = interaction.options.getString('text', true);

      const { channel } = interaction;
      if (channel == null || !channel.isTextBased() || channel.isVoiceBased()) {
        await interaction.reply({ content: '対応していないチャンネルです。', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const messages = await channel.messages.fetch();
      const message = messages?.get(to);

      if (message == null) {
        await interaction.editReply('与えられたメッセージIDに対応するメッセージが見付かりませんでした。');
        return;
      }

      const emojis = toEmojis(text);
      if (emojis.success) {
        await channel.send(`${interaction.user} が \`/emojify "${text}"\` を使用しました。`);

        for (const emojiText of emojis.values) {
          await message.react(emojiText);
        }
        await interaction.deleteReply();
      }
      else {
        await interaction.editReply(emojis.message);
      }
    },
  },
};
