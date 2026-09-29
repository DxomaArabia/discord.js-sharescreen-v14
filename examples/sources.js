'use strict';

// Every kind of source the library understands.
// Run inside a ready client, with `stream` being a ShareScreen instance.
module.exports = async function demo(stream, channel) {
  await stream.start({ channel, source: 'black' });               // black screen
  await stream.setSource('#ff0066');                               // custom hex color
  await stream.setSource('cover.png');                             // image
  await stream.setSource('https://example.com/clip.mp4');          // remote video
  await stream.setSource('page:https://example.com');              // web page (needs puppeteer)
  await stream.setSource({ type: 'color', value: '#00ff88' });     // explicit object form
};
