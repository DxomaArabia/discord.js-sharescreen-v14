# discord.js-sharescreen-v14

Stream local videos, images, solid colors and web pages into a Discord voice channel with discord.js v14. ffmpeg is found (or bundled) automatically, and the whole thing is driven by a handful of methods.

```js
const { ShareScreen } = require('discord.js-sharescreen-v14');

const stream = new ShareScreen(client);

await stream.start({
  channel: voiceChannel,
  source: 'video.mp4',
  resolution: '1080p',
  fps: 60,
});
```

CommonJS, Node 18+, no TypeScript, types are JSDoc.

## Read this first: what Discord allows

Discord's public API lets **bot accounts send audio** in voice channels. It does **not** let bots publish video ("Go Live" / screen share); that only works from user accounts, and automating a user account is against Discord's Terms of Service. This library does not do that.

So here is what you actually get:

| Part | What happens |
| --- | --- |
| Audio | Decoded by ffmpeg and played into the voice channel through `@discordjs/voice`. Works today. |
| Video | Encoded by ffmpeg to H.264 (resolution, fps, bitrate, quality all applied) and emitted as a Node stream on the `video` event. |

The `video` event is the extension point: pipe the stream to a file, an RTMP/HLS server, a browser via WebSocket, or your own transport. If nobody listens to `video`, only audio is processed and a `warning` event (`VIDEO_NOT_ATTACHED`) tells you so. Attach the listener **before** calling `start()`.

## Install

```bash
npm install discord.js-sharescreen-v14 discord.js
```

- `@discordjs/voice` and an Opus encoder (`opusscript`) are installed for you.
- `ffmpeg-static` is installed as an optional dependency. If it can't be installed, the library falls back to `ffmpeg` on your PATH, or to `FFMPEG_PATH` / the `ffmpegPath` option. If none work you get an `FFmpegNotFoundError` with install instructions.
- Web pages need a headless browser: `npm install puppeteer`.

Your client needs the `Guilds` and `GuildVoiceStates` intents, and the bot needs the Connect permission in the channel.

## API

```js
const stream = new ShareScreen(client, defaults?);
```

| Method | Description |
| --- | --- |
| `await stream.start(options)` | Join the channel and start streaming. |
| `await stream.stop()` | Stop and leave the channel. Safe to call anytime. |
| `await stream.pause()` / `resume()` | Pause and continue from the same position. |
| `await stream.setSource(source)` | Swap the source without leaving the channel. The old one keeps playing until the new one is ready. |
| `await stream.setQuality(options)` | Change `resolution`, `width`/`height`, `fps`, `bitrate`, `quality` live, continuing from the current position. |
| `await stream.setLoop(bool)` | Toggle looping. |
| `stream.setVolume(0..2)` | Volume multiplier (1 = original). |
| `stream.mute()` / `unmute()` | Mute audio without changing the volume. |

Properties: `status` (`idle` `starting` `playing` `paused`), `position` (seconds), `source`, `settings`, `volume`, `muted`, `loop`, `channel`.

### start options

| Option | Default | Notes |
| --- | --- | --- |
| `channel` | required | A voice channel object or its ID. |
| `source` | required | See sources below. |
| `resolution` | `"720p"` | `360p` `480p` `720p` `1080p` `1440p` `4k` or `"1280x720"`. |
| `width`, `height` | | Set both to override `resolution`. Rounded down to even numbers. |
| `fps` | `30` | 1 to 60. |
| `bitrate` | auto | kbps as a number, or `"4500k"`, `"4M"`. Auto is derived from size, fps and quality. |
| `quality` | `"medium"` | `low` `medium` `high` `ultra`. Trades CPU for compression. |
| `loop` | `false` | Loop files and remote videos. |
| `audio` | `true` | Set `false` to skip the audio track. |
| `volume` / `muted` | `1` / `false` | |
| `selfDeaf` | `true` | |
| `ffmpegPath` | auto | |
| `connectTimeoutMs`, `sourceTimeoutMs` | `20000` | |
| `webpage` | | `{ captureFps, waitUntil, launchArgs }` for page sources. |

Defaults live in [`config/defaults.js`](config/defaults.js). You can also pass any start option as `defaults` to the constructor.

### Sources

| You pass | You get |
| --- | --- |
| `"video.mp4"` | Local video (any format ffmpeg reads), with its audio. |
| `"cover.png"` | Still image (png, jpg, webp, bmp). |
| `"black"` | Black screen. |
| `"#ff0066"`, `"color:#f06"` | Solid color. |
| `"https://host/clip.mp4"` | Remote video or audio, also `.m3u8`, `rtmp://`, `rtsp://`. |
| `"page:https://example.com"` or any non-media `https://` URL | Web page, rendered by puppeteer at up to 10 screenshots/s. Static and slow-moving pages work well; it is not a full-motion browser capture. |
| `{ type: 'color', value: '#00ff88' }` | Explicit form. Types: `file` `url` `image` `color` `webpage`. |

Images, colors and pages have no audio.

### Events

`ready`, `start`, `video (stream, info)`, `pause`, `resume`, `sourceChange`, `qualityChange`, `finish`, `stop ({ reason, error })`, `warning`, `error`.

- `video` fires again after every restart (pause/resume, source or quality change). Treat each stream as a new segment; every segment begins with SPS/PPS headers so it can be decoded on its own. `info` is `{ codec: 'h264', format: 'annexb', width, height, fps, bitrate }`.
- `stop` always fires when a session ends, whatever the reason (`stopped`, `finished`, `disconnected`, `error`).
- Always add an `error` listener. Without one, fatal errors are printed as a Node process warning.

### Errors

Every error extends `ShareScreenError` and has a stable `code`.

| Class | Codes |
| --- | --- |
| `FFmpegNotFoundError` | `FFMPEG_NOT_FOUND` |
| `SourceError` | `SOURCE_NOT_FOUND`, `SOURCE_INVALID`, `SOURCE_UNREADABLE`, `SOURCE_UNSUPPORTED`, `SOURCE_EMPTY`, `SOURCE_TIMEOUT` |
| `OptionsError` | `INVALID_OPTIONS`, `INVALID_CHANNEL`, `INVALID_COLOR` |
| `VoiceError` | `CHANNEL_NOT_FOUND`, `CHANNEL_NOT_JOINABLE`, `VOICE_CONNECT_TIMEOUT`, `AUDIO_PLAYER_ERROR` |
| `StateError` | `ALREADY_STARTED`, `NOT_STREAMING` |
| `DependencyError` | `DEPENDENCY_MISSING` (puppeteer) |

Invalid sources are detected before anything is played, so `start()` and `setSource()` reject instead of leaving a half-started session.

```js
try {
  await stream.start({ channel, source: 'missing.mp4' });
} catch (err) {
  console.log(err.code, err.message); // SOURCE_NOT_FOUND File not found: /app/missing.mp4
}
```

## Notes and limits

- One `ShareScreen` per guild (a guild can only hold one voice connection per bot).
- Audio and video run as separate ffmpeg processes, so they can drift by a few hundred milliseconds, and looping is not frame-synchronized between them.
- Pause stops the video process and restarts it from the saved position on resume; seeking precision depends on the container.
- Encoding 1080p60 or higher in real time is CPU heavy. Lower `quality` or `fps` if the host struggles.
- Web page mode needs `puppeteer` (or `puppeteer-core` with a browser installed).

## Examples

See [`examples/`](examples): a minimal bot, every source type, a full command bot, and recording the video stream to disk.

## Development

```bash
npm install
npm test
```

The test suite runs the full session logic against a mocked voice layer with real ffmpeg, so no Discord token is needed.

## License

MIT
