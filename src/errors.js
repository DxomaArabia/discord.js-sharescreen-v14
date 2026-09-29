'use strict';

/**
 * Base class for every error thrown or emitted by this library.
 * The `code` property is stable and safe to branch on.
 */
class ShareScreenError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, code, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (options.cause !== undefined) this.cause = options.cause;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** Invalid option values passed by the caller. */
class OptionsError extends ShareScreenError {
  constructor(message, code = 'INVALID_OPTIONS', options) {
    super(message, code, options);
  }
}

/** A method was called in a state where it is not allowed. */
class StateError extends ShareScreenError {
  constructor(message, code = 'INVALID_STATE') {
    super(message, code);
  }
}

/** ffmpeg could not be found or does not run. */
class FFmpegNotFoundError extends ShareScreenError {
  constructor(message, options) {
    super(message, 'FFMPEG_NOT_FOUND', options);
  }
}

/** The source is missing, unreadable, unsupported or broke mid-stream. */
class SourceError extends ShareScreenError {
  constructor(message, code = 'SOURCE_INVALID', options) {
    super(message, code, options);
  }
}

/** Joining or keeping the voice connection failed. */
class VoiceError extends ShareScreenError {
  constructor(message, code = 'VOICE_ERROR', options) {
    super(message, code, options);
  }
}

/** An optional dependency (e.g. puppeteer) is needed but not installed. */
class DependencyError extends ShareScreenError {
  constructor(message, options) {
    super(message, 'DEPENDENCY_MISSING', options);
  }
}

module.exports = {
  ShareScreenError,
  OptionsError,
  StateError,
  FFmpegNotFoundError,
  SourceError,
  VoiceError,
  DependencyError,
};
