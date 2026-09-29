'use strict';

// The "video" event hands you the encoded H.264 stream.
// Here it is written to disk; play the result with: ffplay -f h264 out.h264
const fs = require('node:fs');
const { ShareScreen } = require('discord.js-sharescreen-v14');

module.exports = async function record(client, channel) {
  const stream = new ShareScreen(client);

  stream.on('video', (video, info) => {
    console.log(`video: ${info.width}x${info.height} @ ${info.fps}fps, ${info.bitrate} kbps`);
    video.pipe(fs.createWriteStream('out.h264'));
  });

  await stream.start({ channel, source: 'video.mp4', resolution: '720p', fps: 30, bitrate: '3M' });
};
