'use strict';

const { spawnSync } = require('node:child_process');
const { FFmpegNotFoundError } = require('../errors');

const cache = new Map();

function probe(binary) {
  const result = spawnSync(binary, ['-version'], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || '').split('\n')[0].trim() || 'ffmpeg';
}

function installHint() {
  switch (process.platform) {
    case 'win32':
      return 'Install it with "winget install ffmpeg" or "choco install ffmpeg".';
    case 'darwin':
      return 'Install it with "brew install ffmpeg".';
    default:
      return 'Install it with your package manager, e.g. "sudo apt install ffmpeg".';
  }
}

function tryStatic() {
  try {
    const path = require('ffmpeg-static');
    return typeof path === 'string' ? path : null;
  } catch {
    return null;
  }
}

/**
 * Finds a working ffmpeg binary. Lookup order:
 *  1. the `customPath` argument
 *  2. the FFMPEG_PATH environment variable
 *  3. the bundled `ffmpeg-static` binary
 *  4. `ffmpeg` on the system PATH
 *
 * @param {string} [customPath]
 * @returns {{ path: string, version: string }}
 * @throws {FFmpegNotFoundError}
 */
function locateFFmpeg(customPath) {
  const key = customPath || process.env.FFMPEG_PATH || '';
  if (cache.has(key)) return cache.get(key);

  const explicit = customPath || process.env.FFMPEG_PATH;
  if (explicit) {
    const version = probe(explicit);
    if (!version) {
      throw new FFmpegNotFoundError(
        `The ffmpeg binary "${explicit}" could not be executed. Check the path or remove it to let the library find ffmpeg on its own.`
      );
    }
    const found = { path: explicit, version };
    cache.set(key, found);
    return found;
  }

  const candidates = [tryStatic(), 'ffmpeg'].filter(Boolean);
  for (const candidate of candidates) {
    const version = probe(candidate);
    if (version) {
      const found = { path: candidate, version };
      cache.set(key, found);
      return found;
    }
  }

  throw new FFmpegNotFoundError(
    `ffmpeg was not found. ${installHint()} You can also run "npm install ffmpeg-static" or pass { ffmpegPath } / set FFMPEG_PATH.`
  );
}

module.exports = { locateFFmpeg };
