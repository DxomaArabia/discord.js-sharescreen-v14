'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { Transform } = require('node:stream');
const { FFmpegNotFoundError, SourceError } = require('../errors');
const { explainFFmpegFailure } = require('../utils/explain');

const STDERR_LIMIT = 8192;

/**
 * Wraps one ffmpeg child process that writes to stdout.
 *
 * Events:
 *  - "first": the first chunk of output arrived
 *  - "exit":  the process ended, payload { code, killed, hadData, error }
 */
class FFmpegRunner extends EventEmitter {
  /**
   * @param {{ ffmpegPath: string, args: string[], label: 'audio'|'video', stdin?: boolean }} options
   */
  constructor({ ffmpegPath, args, label, stdin = false }) {
    super();
    this.label = label;
    this.hadData = false;
    this.killed = false;
    this.exited = false;
    this._stderr = '';

    this.process = spawn(ffmpegPath, args, {
      stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const tap = new Transform({
      transform: (chunk, _encoding, callback) => {
        if (!this.hadData) {
          this.hadData = true;
          this.emit('first');
        }
        callback(null, chunk);
      },
    });
    tap.on('error', () => {});

    /** The stream of encoded output. */
    this.output = this.process.stdout.pipe(tap);
    this.process.stdout.on('error', () => {});
    this.process.stdin?.on('error', () => {});

    this.process.stderr.on('data', (chunk) => {
      this._stderr = (this._stderr + chunk.toString()).slice(-STDERR_LIMIT);
    });

    this.process.once('error', (err) => this._finish(null, err));
    this.process.once('close', (code) => this._finish(code, null));
  }

  /** Writable stdin, only available when created with `stdin: true`. */
  get stdin() {
    return this.process.stdin;
  }

  _finish(code, spawnError) {
    if (this.exited) return;
    this.exited = true;
    this.output.end();

    let error = null;
    if (!this.killed && (spawnError || code !== 0)) {
      error = spawnError
        ? spawnError.code === 'ENOENT'
          ? new FFmpegNotFoundError('The ffmpeg binary disappeared or could not be started.', { cause: spawnError })
          : new SourceError(`ffmpeg could not be started: ${spawnError.message}`, 'FFMPEG_START_FAILED', { cause: spawnError })
        : new SourceError(
            `Failed to read the ${this.label} stream: ${explainFFmpegFailure(this._stderr)}.`,
            'SOURCE_INVALID'
          );
    }
    if (!error && !this.killed && !this.hadData) {
      error = new SourceError(`The source has no usable ${this.label} stream.`, 'SOURCE_EMPTY');
    }
    /** Set once the process has ended. */
    this.exitInfo = { code, killed: this.killed, hadData: this.hadData, error };
    this.emit('exit', this.exitInfo);
  }

  kill() {
    if (this.exited || this.killed) return;
    this.killed = true;
    this.process.stdout.unpipe();
    this.process.kill('SIGKILL');
  }
}

module.exports = { FFmpegRunner };
