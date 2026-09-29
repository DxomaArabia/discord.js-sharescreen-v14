'use strict';

const { FFmpegRunner } = require('./runner');
const { WebCapture } = require('./webcapture');

const BASE_ARGS = ['-hide_banner', '-loglevel', 'error'];

/**
 * Input arguments shared by the audio and video commands.
 * @param {import('./source').ResolvedSource} source
 * @param {{ loop: boolean, position: number, realtime: boolean, fps: number, width: number, height: number, captureFps: number }} o
 */
function inputArgs(source, o) {
  const args = [];
  switch (source.type) {
    case 'file':
    case 'url': {
      if (source.type === 'url' && source.value.startsWith('http')) {
        args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
      }
      if (o.loop && source.seekable) args.push('-stream_loop', '-1');
      if (o.position > 0.5 && source.seekable) args.push('-ss', o.position.toFixed(2));
      if (o.realtime) args.push('-re');
      args.push('-i', source.value);
      break;
    }
    case 'image':
      args.push('-re', '-loop', '1', '-framerate', String(o.fps), '-i', source.value);
      break;
    case 'color':
      args.push('-re', '-f', 'lavfi', '-i', `color=c=${source.value}:s=${o.width}x${o.height}:r=${o.fps}`);
      break;
    case 'webpage':
      args.push('-f', 'image2pipe', '-framerate', String(o.captureFps), '-c:v', 'mjpeg', '-i', 'pipe:0');
      break;
    default:
      throw new Error(`Unhandled source type ${source.type}`);
  }
  return args;
}

/**
 * Builds the ffmpeg argument list that decodes audio to raw 48 kHz stereo PCM.
 */
function buildAudioArgs(source, o) {
  return [
    ...BASE_ARGS,
    '-nostdin',
    ...inputArgs(source, { ...o, realtime: false }),
    '-vn',
    '-map', '0:a:0?',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ];
}

/**
 * Builds the ffmpeg argument list that encodes video to a raw H.264 Annex B stream.
 */
function buildVideoArgs(source, settings, o) {
  const { width, height, fps, bitrate, preset } = settings;
  const filter = [
    `fps=${fps}`,
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    'format=yuv420p',
  ].join(',');

  return [
    ...BASE_ARGS,
    ...(source.type === 'webpage' ? [] : ['-nostdin']),
    ...inputArgs(source, { ...o, fps, width, height, realtime: true }),
    '-map', '0:v:0?',
    '-an',
    '-vf', filter,
    '-c:v', 'libx264',
    '-preset', preset,
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-b:v', `${bitrate}k`,
    '-maxrate', `${bitrate}k`,
    '-bufsize', `${bitrate}k`,
    '-g', String(fps * 2),
    '-x264-params', 'repeat-headers=1',
    '-f', 'h264',
    'pipe:1',
  ];
}

/**
 * Owns the ffmpeg processes (and the optional browser) for one source and one
 * set of quality settings. Audio and video run as separate processes so that
 * video can be restarted on its own when the stream is paused.
 */
class Pipeline {
  /**
   * @param {Object} config
   * @param {string} config.ffmpegPath
   * @param {import('./source').ResolvedSource} config.source
   * @param {ReturnType<typeof import('./settings').resolveSettings>} config.settings
   * @param {boolean} config.loop
   * @param {{ captureFps: number, waitUntil: string, launchArgs: string[] }} config.webpage
   */
  constructor(config) {
    this.config = config;
    this.audio = null;
    this.video = null;
    this.capture = null;
    this.destroyed = false;
  }

  _common(position) {
    const { settings, webpage, loop } = this.config;
    return {
      loop,
      position,
      fps: settings.fps,
      width: settings.width,
      height: settings.height,
      captureFps: Math.min(webpage.captureFps, settings.fps),
    };
  }

  /**
   * @param {number} [position=0] seconds
   * @returns {FFmpegRunner|null} null when the source has no audio
   */
  startAudio(position = 0) {
    const { source, ffmpegPath } = this.config;
    if (!source.hasAudio || this.destroyed) return null;
    this.audio = new FFmpegRunner({
      ffmpegPath,
      label: 'audio',
      args: buildAudioArgs(source, this._common(position)),
    });
    return this.audio;
  }

  /**
   * @param {number} [position=0] seconds
   * @returns {Promise<FFmpegRunner|null>}
   */
  async startVideo(position = 0) {
    const { source, ffmpegPath, settings, webpage } = this.config;
    if (this.destroyed) return null;
    const common = this._common(position);

    if (source.type === 'webpage') {
      const capture = new WebCapture({
        url: source.value,
        width: settings.width,
        height: settings.height,
        captureFps: common.captureFps,
        waitUntil: webpage.waitUntil,
        launchArgs: webpage.launchArgs,
      });
      await capture.open(); // throws SourceError / DependencyError
      if (this.destroyed) {
        await capture.close();
        return null;
      }
      this.capture = capture;
      this.video = new FFmpegRunner({
        ffmpegPath,
        label: 'video',
        stdin: true,
        args: buildVideoArgs(source, settings, common),
      });
      capture.pump(this.video.stdin);
      return this.video;
    }

    this.video = new FFmpegRunner({
      ffmpegPath,
      label: 'video',
      args: buildVideoArgs(source, settings, common),
    });
    return this.video;
  }

  stopVideo() {
    this.video?.kill();
    this.video = null;
    if (this.capture) {
      this.capture.close();
      this.capture = null;
    }
  }

  destroy() {
    this.destroyed = true;
    this.stopVideo();
    this.audio?.kill();
    this.audio = null;
  }
}

module.exports = { Pipeline, buildAudioArgs, buildVideoArgs };
