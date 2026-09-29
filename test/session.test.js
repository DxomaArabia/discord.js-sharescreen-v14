'use strict';

// Exercises ShareScreen end to end with a fake @discordjs/voice, so no Discord
// connection is needed. Requires a working ffmpeg on the machine.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter, once } = require('node:events');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

function makeFakeVoice() {
  const S = { Idle: 'idle', Playing: 'playing', Paused: 'paused' };
  class Player extends EventEmitter {
    constructor() { super(); this.state = { status: S.Idle }; this.played = 0; }
    play(resource) {
      const prev = this.state;
      this.state = { status: S.Playing, resource };
      this.played += 1;
      resource.stream.on('data', () => {});
      resource.stream.once('end', () => {
        if (this.state.resource !== resource) return;
        const old = this.state;
        this.state = { status: S.Idle };
        this.emit('stateChange', old, this.state);
      });
      this.emit('stateChange', prev, this.state);
    }
    pause() { this.paused = true; return true; }
    unpause() { this.paused = false; return true; }
    stop() { this.state = { status: S.Idle }; return true; }
  }
  return {
    AudioPlayerStatus: S,
    VoiceConnectionStatus: { Ready: 'ready', Destroyed: 'destroyed', Disconnected: 'disconnected', Signalling: 's', Connecting: 'c' },
    NoSubscriberBehavior: { Play: 'play' },
    StreamType: { Raw: 'raw' },
    entersState: async () => {},
    createAudioPlayer: () => new Player(),
    createAudioResource: (stream) => ({ stream, volume: { value: 1, setVolume(v) { this.value = v; } } }),
    joinVoiceChannel: () => {
      const c = new EventEmitter();
      c.state = { status: 'ready' };
      c.subscribe = () => {};
      c.destroy = () => { c.state = { status: 'destroyed' }; c.emit('stateChange', {}, c.state); };
      return c;
    },
  };
}

const fake = makeFakeVoice();
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === '@discordjs/voice' ? fake : originalLoad.call(this, request, ...rest);
};
const { ShareScreen } = require('../src/ShareScreen');
Module._load = originalLoad;

const hasFFmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const opts = { skip: !hasFFmpeg && 'ffmpeg not installed' };

const channel = {
  id: '1', name: 'General', joinable: true,
  guild: { id: '2', voiceAdapterCreator: () => ({}) },
  isVoiceBased: () => true,
};
const client = Object.assign(new EventEmitter(), { channels: { fetch: async () => channel } });

function collect(stream) {
  const state = { bytes: 0 };
  stream.on('data', (c) => { state.bytes += c.length; });
  stream.on('error', () => {});
  return state;
}

const clip = path.join(os.tmpdir(), `sharescreen-test-${process.pid}.mp4`);
test('create a 2 second test clip', opts, () => {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  assert.equal(r.status, 0);
});

test('streams a file, emits video, reports finish and leaves', opts, async () => {
  const stream = new ShareScreen(client);
  let video;
  stream.on('video', (s, info) => { video = collect(s); video.info = info; });
  await stream.start({ channel, source: clip, resolution: '360p', fps: 15 });
  assert.equal(stream.status, 'playing');
  await once(stream, 'finish');
  assert.equal(stream.status, 'idle');
  assert.ok(video.bytes > 500, `expected video bytes, got ${video.bytes}`);
  assert.equal(video.info.width, 640);
});

test('audio-only mode works without a video listener', opts, async () => {
  const stream = new ShareScreen(client);
  const warnings = [];
  stream.on('warning', (w) => warnings.push(w.code));
  await stream.start({ channel, source: clip });
  assert.deepEqual(warnings, ['VIDEO_NOT_ATTACHED']);
  await once(stream, 'finish');
});

test('color source: pause, resume, setSource, setQuality, stop', opts, async () => {
  const stream = new ShareScreen(client);
  const streams = [];
  stream.on('video', (s) => streams.push(collect(s)));
  await stream.start({ channel, source: '#336699', resolution: '360p', fps: 10 });
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(streams[0].bytes > 0);

  await stream.pause();
  assert.equal(stream.status, 'paused');
  await stream.resume();
  assert.equal(stream.status, 'playing');
  assert.equal(streams.length, 2);

  await stream.setSource('black');
  assert.equal(stream.source, 'black screen');
  await stream.setQuality({ resolution: '480p', fps: 15, bitrate: '1M' });
  assert.equal(stream.settings.width, 854);
  assert.equal(stream.settings.bitrate, 1000);

  stream.setVolume(0.5).mute();
  assert.equal(stream.muted, true);

  await stream.stop();
  assert.equal(stream.status, 'idle');
  await assert.rejects(stream.pause(), { code: 'NOT_STREAMING' });
});

test('invalid sources fail fast with useful errors and leave nothing running', opts, async () => {
  const stream = new ShareScreen(client);
  await assert.rejects(stream.start({ channel, source: '/no/such/video.mp4' }), { code: 'SOURCE_NOT_FOUND' });
  const bad = path.join(os.tmpdir(), `sharescreen-bad-${process.pid}.mp4`);
  fs.writeFileSync(bad, 'this is not a video');
  await assert.rejects(stream.start({ channel, source: bad }), (e) => e.code === 'SOURCE_INVALID' && /not a valid/.test(e.message));
  assert.equal(stream.status, 'idle');
  fs.unlinkSync(bad);
});

test('option validation errors', opts, async () => {
  const stream = new ShareScreen(client);
  await assert.rejects(stream.start({ channel, source: 'black', fps: 500 }), { code: 'INVALID_OPTIONS' });
  await assert.rejects(stream.start({ channel: { isVoiceBased: () => false }, source: 'black' }), { code: 'INVALID_CHANNEL' });
  assert.throws(() => new ShareScreen({}), { code: 'INVALID_OPTIONS' });
});

test('cleanup', () => { try { fs.unlinkSync(clip); } catch { /* ignore */ } });
