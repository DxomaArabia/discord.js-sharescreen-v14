'use strict';

// A small command bot showing the whole API.
// Commands: !play <file|url|#hex|black>, !pause, !resume, !stop, !source <x>,
//           !quality <resolution> <fps>, !volume <0-2>, !mute, !unmute, !loop
const { Client, GatewayIntentBits } = require('discord.js');
const { ShareScreen } = require('discord.js-sharescreen-v14');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const sessions = new Map(); // guildId -> ShareScreen

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith('!')) return;
  const [command, ...args] = message.content.slice(1).split(/\s+/);
  const stream = sessions.get(message.guild.id);

  try {
    switch (command) {
      case 'play': {
        const channel = message.member.voice.channel;
        if (!channel) return message.reply('Join a voice channel first.');
        if (stream) await stream.stop();

        const next = new ShareScreen(client);
        sessions.set(message.guild.id, next);
        next.on('warning', (w) => console.warn(w.code, w.message));
        next.on('error', (e) => message.channel.send(`Stream error: ${e.message}`));
        next.on('stop', () => sessions.delete(message.guild.id));
        await next.start({ channel, source: args.join(' '), resolution: '720p', fps: 30 });
        return message.reply('Streaming.');
      }
      case 'pause': return void (await stream?.pause());
      case 'resume': return void (await stream?.resume());
      case 'stop': return void (await stream?.stop());
      case 'source': return void (await stream?.setSource(args.join(' ')));
      case 'quality': return void (await stream?.setQuality({ resolution: args[0], fps: Number(args[1]) || 30 }));
      case 'volume': return void stream?.setVolume(Number(args[0]));
      case 'mute': return void stream?.mute();
      case 'unmute': return void stream?.unmute();
      case 'loop': return void (await stream?.setLoop(!stream.loop));
    }
  } catch (error) {
    message.reply(`${error.code ?? 'ERROR'}: ${error.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
