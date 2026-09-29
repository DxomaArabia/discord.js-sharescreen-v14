'use strict';

/**
 * Named resolutions. Any "WIDTHxHEIGHT" string (e.g. "1600x900") is accepted too.
 */
const RESOLUTIONS = Object.freeze({
  '360p': { width: 640, height: 360 },
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
});

/**
 * Quality presets. `preset` is the x264 speed preset (faster = lower CPU use),
 * `bitsPerPixel` is used to derive a bitrate when none is given explicitly.
 */
const QUALITY_PRESETS = Object.freeze({
  low: { preset: 'ultrafast', bitsPerPixel: 0.04 },
  medium: { preset: 'superfast', bitsPerPixel: 0.07 },
  high: { preset: 'veryfast', bitsPerPixel: 0.1 },
  ultra: { preset: 'faster', bitsPerPixel: 0.14 },
});

const LIMITS = Object.freeze({
  minFps: 1,
  maxFps: 60,
  minSize: 16,
  maxSize: 7680,
  minBitrateKbps: 100,
  maxBitrateKbps: 50000,
  maxVolume: 2,
});

const DEFAULTS = Object.freeze({
  resolution: '720p',
  fps: 30,
  quality: 'medium',
  bitrate: undefined, // derived from resolution, fps and quality
  volume: 1,
  muted: false,
  loop: false,
  audio: true,
  ffmpegPath: undefined,
  connectTimeoutMs: 20000,
  sourceTimeoutMs: 20000,
  webpage: Object.freeze({
    captureFps: 10, // screenshots per second; the encoder duplicates frames up to `fps`
    waitUntil: 'networkidle2',
    launchArgs: Object.freeze(['--no-sandbox', '--disable-setuid-sandbox']),
  }),
});

module.exports = { RESOLUTIONS, QUALITY_PRESETS, LIMITS, DEFAULTS };
