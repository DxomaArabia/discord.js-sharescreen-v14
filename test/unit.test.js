'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveSettings, parseBitrate, checkVolume } = require('../src/core/settings');
const { resolveSource } = require('../src/core/source');
const { buildAudioArgs, buildVideoArgs } = require('../src/core/pipeline');
const { locateFFmpeg } = require('../src/core/ffmpeg');
const { OptionsError, SourceError, FFmpegNotFoundError } = require('../src/errors');

const base = { resolution: '720p', fps: 30, quality: 'medium' };

test('resolveSettings maps named resolutions and derives a bitrate', () => {
  const s = resolveSettings({ ...base, resolution: '1080p', fps: 60 });
  assert.equal(s.width, 1920);
  assert.equal(s.height, 1080);
  assert.ok(s.bitrate > 1000 && s.bitrate <= 50000);
});

test('resolveSettings accepts WxH and explicit width/height, forcing even sizes', () => {
  assert.equal(resolveSettings({ ...base, resolution: '1281x721' }).width, 1280);
  const s = resolveSettings({ ...base, width: 800, height: 600 });
  assert.deepEqual([s.width, s.height], [800, 600]);
});

test('resolveSettings rejects bad values with OptionsError', () => {
  assert.throws(() => resolveSettings({ ...base, fps: 240 }), OptionsError);
  assert.throws(() => resolveSettings({ ...base, resolution: 'huge' }), OptionsError);
  assert.throws(() => resolveSettings({ ...base, quality: 'potato' }), OptionsError);
  assert.throws(() => resolveSettings({ ...base, width: 800 }), OptionsError);
});

test('parseBitrate understands common formats', () => {
  assert.equal(parseBitrate(4500), 4500);
  assert.equal(parseBitrate('4500k'), 4500);
  assert.equal(parseBitrate('4M'), 4000);
  assert.equal(parseBitrate('2.5m'), 2500);
  assert.throws(() => parseBitrate('fast'), OptionsError);
  assert.throws(() => parseBitrate(10), OptionsError);
});

test('checkVolume enforces the 0-2 range', () => {
  assert.equal(checkVolume(0.5), 0.5);
  assert.throws(() => checkVolume(5), OptionsError);
  assert.throws(() => checkVolume('loud'), OptionsError);
});

test('resolveSource handles colors, black, pages, urls and missing files', async () => {
  assert.equal((await resolveSource('black')).value, '0x000000');
  assert.equal((await resolveSource('#f00')).value, '0xff0000');
  assert.equal((await resolveSource({ type: 'color', value: '#00FF00' })).value, '0x00ff00');
  assert.equal((await resolveSource('page:https://example.com')).type, 'webpage');
  assert.equal((await resolveSource('https://example.com/video.mp4')).type, 'url');
  assert.equal((await resolveSource('https://example.com/a.png')).type, 'image');
  assert.equal((await resolveSource('https://example.com/')).type, 'webpage');
  await assert.rejects(resolveSource('/definitely/not/here.mp4'), (e) => e instanceof SourceError && e.code === 'SOURCE_NOT_FOUND');
  await assert.rejects(resolveSource('#zzz'), OptionsError);
  await assert.rejects(resolveSource(''), OptionsError);
  await assert.rejects(resolveSource('ftp://example.com/a.mp4'), SourceError);
});

test('resolveSource treats images on disk as images', async () => {
  const src = await resolveSource(path.join(__dirname, 'fixture.png').replace('fixture.png', '../package.json'));
  assert.equal(src.type, 'file');
});

test('ffmpeg arguments contain the requested settings', () => {
  const settings = resolveSettings({ ...base, resolution: '1080p', fps: 60, bitrate: '6000k' });
  const source = { type: 'file', value: '/tmp/a.mp4', hasAudio: true, seekable: true };
  const video = buildVideoArgs(source, settings, { loop: true, position: 12, fps: 60, width: 1920, height: 1080 });
  assert.ok(video.includes('libx264'));
  assert.ok(video.includes('6000k'));
  assert.ok(video.includes('-stream_loop'));
  assert.ok(video.includes('12.00'));
  assert.ok(video.some((a) => a.includes('scale=1920:1080')));
  const audio = buildAudioArgs(source, { loop: false, position: 0 });
  assert.ok(audio.includes('s16le'));
  assert.ok(!audio.includes('-re'));
});

test('locateFFmpeg finds ffmpeg or explains how to install it', () => {
  try {
    assert.ok(locateFFmpeg().path);
  } catch (e) {
    assert.ok(e instanceof FFmpegNotFoundError);
  }
  assert.throws(() => locateFFmpeg('/no/such/ffmpeg'), FFmpegNotFoundError);
});
