'use strict';

// Minimal example: join a voice channel and play a local video (audio goes to the channel).
const { Client, GatewayIntentBits } = require('discord.js');
const { ShareScreen } = require('discord.js-sharescreen-v14');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once('clientReady', async () => {
  const channel = await client.channels.fetch(process.env.VOICE_CHANNEL_ID);
  const stream = new ShareScreen(client);

  stream.on('error', console.error);
  await stream.start({ channel, source: 'video.mp4', resolution: '1080p', fps: 60 });
});

client.login(process.env.DISCORD_TOKEN);
