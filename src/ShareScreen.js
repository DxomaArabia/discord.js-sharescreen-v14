'use strict';

const { EventEmitter } = require('node:events');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  NoSubscriberBehavior,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} = require('@discordjs/voice');

const { DEFAULTS } = require('../config/defaults');
const { OptionsError, StateError, VoiceError } = require('./errors');
const { locateFFmpeg } = require('./core/ffmpeg');
const { resolveSource } = require('./core/source');
const { resolveSettings, checkVolume } = require('./core/settings');
const { Pipeline } = require('./core/pipeline');
const { waitForFirstData } = require('./utils/wait');

const QUALITY_KEYS = ['resolution', 'width', 'height', 'fps', 'bitrate', 'quality'];

function pickQuality(source = {}) {
  const out = {};
  for (const key of QUALITY_KEYS) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/** Merges quality options; an explicit `resolution` replaces earlier width/height. */
function mergeQuality(base, patch) {
  const merged = { ...base, ...patch };
  if (patch.resolution !== undefined && patch.width === undefined && patch.height === undefined) {
    delete merged.width;
    delete merged.height;
  }
  return merged;
}

/**
 * Streams a video, image, color or web page into a Discord voice channel.
 *
 * Audio is played through the voice connection. Encoded H.264 video is
 * emitted through the "video" event; see the README for why.
 *
 * Events:
 *  - "ready"         voice connection established, (channel)
 *  - "start"         playback started, (info)
 *  - "video"         (stream, info) a raw H.264 Annex B stream; emitted again after every restart
 *  - "pause" / "resume"
 *  - "sourceChange"  (label)
 *  - "qualityChange" (settings)
 *  - "finish"        the source ended and looping is off
 *  - "stop"          ({ reason, error }) always fires when a session ends
 *  - "warning"       (warning) non-fatal problem, has a `code`
 *  - "error"         (error) fatal problem; the session is torn down afterwards
 *
 * @extends EventEmitter
 */
class ShareScreen extends EventEmitter {
  /**
   * @param {import('discord.js').Client} client
   * @param {Partial<import('./types').StartOptions>} [defaults]  Options applied to every start().
   */
  constructor(client, defaults = {}) {
    super();
    if (!client || typeof client.on !== 'function' || !client.channels) {
      throw new OptionsError('ShareScreen needs a discord.js Client: new ShareScreen(client).');
    }
    this.client = client;
    this._defaults = defaults;

    this._status = 'idle';
    this._queue = Promise.resolve();
    this._connection = null;
    this._player = null;
    this._channel = null;
    this._config = null;
    this._gen = null;
    this._genCounter = 0;
    this._dirty = false;
    this._clock = { base: 0, since: null };
    this._volume = DEFAULTS.volume;
    this._muted = DEFAULTS.muted;
  }

  // ---------------------------------------------------------------- getters

  /** @returns {import('./types').Status} */
  get status() { return this._status; }

  /** Playback position in seconds. */
  get position() {
    return this._clock.base + (this._clock.since ? (Date.now() - this._clock.since) / 1000 : 0);
  }

  /** Human readable description of the current source, or null. */
  get source() { return this._config ? this._config.source.label : null; }

  /** The encoder settings currently in use, or null. */
  get settings() { return this._config ? { ...this._config.settings } : null; }

  get volume() { return this._volume; }
  get muted() { return this._muted; }
  get loop() { return this._config ? this._config.loop : false; }
  get channel() { return this._channel; }

  // ------------------------------------------------------------- public API

  /**
   * Joins a voice channel and starts streaming.
   * @param {import('./types').StartOptions} options
   * @returns {Promise<this>}
   */
  start(options) {
    return this._exclusive(() => this._start(options));
  }

  /**
   * Stops the stream and leaves the voice channel. Safe to call at any time.
   * @returns {Promise<this>}
   */
  stop() {
    return this._exclusive(async () => {
      this._teardown('stopped');
      return this;
    });
  }

  /**
   * Pauses audio and video. The playback position is remembered.
   * @returns {Promise<this>}
   */
  pause() {
    return this._exclusive(async () => {
      this._assertActive('pause');
      if (this._status === 'paused') return this;
      this._clock = { base: this.position, since: null };
      this._player.pause(true);
      this._gen.pipeline.stopVideo();
      this._status = 'paused';
      this.emit('pause');
      return this;
    });
  }

  /**
   * Resumes after pause().
   * @returns {Promise<this>}
   */
  resume() {
    return this._exclusive(async () => {
      this._assertActive('resume');
      if (this._status !== 'paused') return this;
      const position = this.position;

      if (this._dirty) {
        this._dirty = false;
        const gen = await this._prepare(this._config, position);
        this._activate(gen, position);
      } else {
        this._player.unpause();
        const video = await this._gen.pipeline.startVideo(position);
        if (video) {
          this._gen.video = video;
          this._watch(this._gen, video);
          this.emit('video', video.output, this._videoInfo(this._config.settings));
        }
        this._clock = { base: position, since: Date.now() };
      }
      this._status = 'playing';
      this.emit('resume');
      return this;
    });
  }

  /**
   * Switches to another source without leaving the channel.
   * @param {import('./types').SourceInput} source
   * @returns {Promise<this>}
   */
  setSource(source) {
    return this._exclusive(async () => {
      this._assertActive('setSource');
      const resolved = await resolveSource(source); // validate before touching anything
      const next = { ...this._config, source: resolved };
      await this._swap(next, 0);
      this.emit('sourceChange', resolved.label);
      return this;
    });
  }

  /**
   * Changes resolution, fps, bitrate or quality while streaming.
   * The stream continues from the current position.
   * @param {import('./types').QualityOptions} options
   * @returns {Promise<this>}
   */
  setQuality(options) {
    return this._exclusive(async () => {
      this._assertActive('setQuality');
      if (!options || typeof options !== 'object') throw new OptionsError('setQuality expects an options object.');
      const unknown = Object.keys(options).filter((k) => !QUALITY_KEYS.includes(k));
      if (unknown.length) {
        throw new OptionsError(`Unknown quality option(s): ${unknown.join(', ')}. Allowed: ${QUALITY_KEYS.join(', ')}.`);
      }
      const quality = mergeQuality(this._config.quality, pickQuality(options));
      const settings = resolveSettings(quality);
      await this._swap({ ...this._config, quality, settings }, this.position);
      this.emit('qualityChange', { ...settings });
      return this;
    });
  }

  /**
   * Turns looping on or off. Restarts the pipeline from the current position.
   * @param {boolean} enabled
   * @returns {Promise<this>}
   */
  setLoop(enabled) {
    return this._exclusive(async () => {
      this._assertActive('setLoop');
      await this._swap({ ...this._config, loop: Boolean(enabled) }, this.position);
      return this;
    });
  }

  /**
   * @param {number} volume Multiplier from 0 to 2 (1 = original volume).
   * @returns {this}
   */
  setVolume(volume) {
    this._volume = checkVolume(volume);
    this._applyVolume();
    return this;
  }

  /** @returns {this} */
  mute() {
    this._muted = true;
    this._applyVolume();
    return this;
  }

  /** @returns {this} */
  unmute() {
    this._muted = false;
    this._applyVolume();
    return this;
  }

  // ---------------------------------------------------------------- internals

  _exclusive(fn) {
    const run = this._queue.then(fn);
    this._queue = run.catch(() => {});
    return run;
  }

  _assertActive(method) {
    if (this._status !== 'playing' && this._status !== 'paused') {
      throw new StateError(`Cannot call ${method}() because nothing is streaming. Call start() first.`, 'NOT_STREAMING');
    }
  }

  _applyVolume() {
    const resource = this._gen && this._gen.resource;
    if (resource && resource.volume) resource.volume.setVolume(this._muted ? 0 : this._volume);
  }

  _emitError(error) {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    } else {
      process.emitWarning(error.message, { type: 'ShareScreenError', code: error.code });
    }
  }

  _videoInfo(settings) {
    return {
      codec: 'h264',
      format: 'annexb',
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      bitrate: settings.bitrate,
    };
  }

  async _start(options) {
    if (this._status !== 'idle') {
      throw new StateError('A stream is already running. Call stop() first, or use setSource() to change what is playing.', 'ALREADY_STARTED');
    }
    if (!options || typeof options !== 'object') {
      throw new OptionsError('start() expects an options object: { channel, source, ... }.');
    }

    const merged = { ...DEFAULTS, ...this._defaults, ...options };
    const quality = mergeQuality(
      mergeQuality(pickQuality(DEFAULTS), pickQuality(this._defaults)),
      pickQuality(options)
    );

    const ffmpeg = locateFFmpeg(merged.ffmpegPath); // throws FFmpegNotFoundError early
    const settings = resolveSettings(quality);
    this._volume = checkVolume(merged.volume);
    this._muted = Boolean(merged.muted);
    const source = await resolveSource(merged.source);
    const channel = await this._resolveChannel(merged.channel);

    const config = {
      ffmpegPath: ffmpeg.path,
      source,
      quality,
      settings,
      loop: Boolean(merged.loop),
      audio: merged.audio !== false,
      sourceTimeoutMs: merged.sourceTimeoutMs,
      webpage: { ...DEFAULTS.webpage, ...(merged.webpage || {}) },
    };

    this._status = 'starting';
    this._config = config;
    this._channel = channel;

    try {
      await this._connect(channel, merged);
      this.emit('ready', channel);

      if (!this.listenerCount('video')) {
        this.emit('warning', {
          code: 'VIDEO_NOT_ATTACHED',
          message:
            'Discord does not accept video from bot accounts, so only audio is sent to the channel. ' +
            'Listen for the "video" event to receive the encoded H.264 stream.',
        });
      }

      const gen = await this._prepare(config, 0);
      this._activate(gen, 0);
      this._status = 'playing';
      this.emit('start', { source: source.label, ...settings, channel: channel.id });
      return this;
    } catch (error) {
      this._teardown('error', error);
      throw error;
    }
  }

  async _resolveChannel(input) {
    let channel = input;
    if (typeof input === 'string') {
      channel = await this.client.channels.fetch(input).catch(() => null);
      if (!channel) throw new VoiceError(`No channel with the id ${input} was found.`, 'CHANNEL_NOT_FOUND');
    }
    if (!channel || typeof channel.isVoiceBased !== 'function' || !channel.isVoiceBased()) {
      throw new OptionsError('channel must be a voice channel (or the id of one).', 'INVALID_CHANNEL');
    }
    if (channel.joinable === false) {
      throw new VoiceError(
        `The bot cannot join "${channel.name}". It is missing the Connect permission or the channel is full.`,
        'CHANNEL_NOT_JOINABLE'
      );
    }
    return channel;
  }

  async _connect(channel, options) {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: options.selfDeaf !== false,
    });
    this._connection = connection;

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, options.connectTimeoutMs);
    } catch (cause) {
      throw new VoiceError(
        `Could not connect to "${channel.name}" within ${options.connectTimeoutMs} ms. Check the bot's permissions and network.`,
        'VOICE_CONNECT_TIMEOUT',
        { cause }
      );
    }

    connection.on('stateChange', (_old, next) => {
      if (this._connection !== connection) return;
      if (next.status === VoiceConnectionStatus.Destroyed) {
        this._teardown('disconnected');
      } else if (next.status === VoiceConnectionStatus.Disconnected) {
        this._handleDisconnect(connection);
      }
    });

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    player.on('error', (cause) => {
      this._emitError(new VoiceError(`Audio player error: ${cause.message}`, 'AUDIO_PLAYER_ERROR', { cause }));
      this._teardown('error', cause);
    });
    player.on('stateChange', (previous, next) => {
      if (next.status !== AudioPlayerStatus.Idle || previous.status === AudioPlayerStatus.Idle) return;
      const gen = this._gen;
      if (gen && gen.resource && previous.resource === gen.resource) {
        gen.active.delete('audio');
        this._checkDone(gen);
      }
    });
    connection.subscribe(player);
    this._player = player;
  }

  async _handleDisconnect(connection) {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      if (this._connection === connection) this._teardown('disconnected');
    }
  }

  /**
   * Starts ffmpeg for `config` and waits until it delivers data.
   * Nothing is played until _activate() is called with the result.
   */
  async _prepare(config, position) {
    const pipeline = new Pipeline(config);
    const gen = {
      id: ++this._genCounter,
      config,
      pipeline,
      audio: null,
      video: null,
      resource: null,
      active: new Set(),
    };

    try {
      const runners = [];
      if (config.audio) {
        gen.audio = pipeline.startAudio(position);
        if (gen.audio) runners.push(gen.audio);
      }
      if (this.listenerCount('video') > 0) {
        gen.video = await pipeline.startVideo(position);
        if (gen.video) runners.push(gen.video);
      }
      await waitForFirstData(runners, config.sourceTimeoutMs);
    } catch (error) {
      pipeline.destroy();
      throw error;
    }
    return gen;
  }

  /** Makes a prepared generation the live one and retires the previous one. */
  _activate(gen, position) {
    const previous = this._gen;
    this._gen = gen;
    if (previous) previous.pipeline.destroy();

    if (gen.audio) {
      gen.resource = createAudioResource(gen.audio.output, { inputType: StreamType.Raw, inlineVolume: true });
      this._applyVolume();
      this._player.play(gen.resource);
    } else {
      this._player.stop(true);
    }

    this._clock = { base: position, since: Date.now() };
    for (const runner of [gen.audio, gen.video]) if (runner) this._watch(gen, runner);

    if (gen.video) this.emit('video', gen.video.output, this._videoInfo(gen.config.settings));
  }

  /** Prepares and activates new config, or defers it if paused. */
  async _swap(nextConfig, position) {
    if (this._status === 'paused') {
      this._config = nextConfig;
      this._dirty = true;
      this._clock = { base: position, since: null };
      return;
    }
    const gen = await this._prepare(nextConfig, position);
    this._config = nextConfig;
    this._activate(gen, position);
  }

  _watch(gen, runner) {
    gen.active.add(runner.label);
    const handle = (info) => {
      if (info.killed || this._gen !== gen) return;

      if (info.error) {
        const other = runner.label === 'audio' ? gen.video : gen.audio;
        if (!info.hadData && other && !other.exited) {
          // e.g. a video file without audio, or an mp3 without video
          gen.active.delete(runner.label);
          this.emit('warning', {
            code: runner.label === 'audio' ? 'NO_AUDIO' : 'NO_VIDEO',
            message: info.error.message,
          });
          return this._checkDone(gen);
        }
        this._emitError(info.error);
        return this._teardown('error', info.error);
      }

      if (runner.label === 'video') {
        gen.active.delete('video');
        this._checkDone(gen);
      }
    };

    if (runner.exited) setImmediate(() => handle(runner.exitInfo));
    else runner.once('exit', handle);
  }

  _checkDone(gen) {
    if (this._gen === gen && gen.active.size === 0 && this._status !== 'starting') {
      this.emit('finish');
      this._teardown('finished');
    }
  }

  _teardown(reason, error) {
    if (this._status === 'idle') return;

    const gen = this._gen;
    const player = this._player;
    const connection = this._connection;

    this._gen = null;
    this._player = null;
    this._connection = null;
    this._channel = null;
    this._config = null;
    this._dirty = false;
    this._clock = { base: 0, since: null };
    this._status = 'idle';

    if (gen) gen.pipeline.destroy();
    if (player) {
      player.removeAllListeners();
      player.on('error', () => {});
      player.stop(true);
    }
    if (connection) {
      try {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      } catch { /* already destroyed */ }
    }

    this.emit('stop', { reason, error });
  }
}

module.exports = { ShareScreen };
