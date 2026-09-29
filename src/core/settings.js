'use strict';

const { RESOLUTIONS, QUALITY_PRESETS, LIMITS } = require('../../config/defaults');
const { OptionsError } = require('../errors');

/**
 * Parses "4500", 4500, "4500k", "4.5m" or "4500kbps" into kbps.
 * @param {number|string} value
 * @returns {number}
 */
function parseBitrate(value) {
  let kbps;
  if (typeof value === 'number') {
    kbps = value;
  } else if (typeof value === 'string') {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(k|kbps|m|mbps)?\s*$/i.exec(value);
    if (!match) throw new OptionsError(`Invalid bitrate "${value}". Use a number of kbps or a string like "4500k" or "4M".`);
    kbps = Number(match[1]);
    if (match[2] && match[2].toLowerCase().startsWith('m')) kbps *= 1000;
  } else {
    throw new OptionsError('bitrate must be a number (kbps) or a string such as "4500k".');
  }
  kbps = Math.round(kbps);
  if (!Number.isFinite(kbps) || kbps < LIMITS.minBitrateKbps || kbps > LIMITS.maxBitrateKbps) {
    throw new OptionsError(`bitrate must be between ${LIMITS.minBitrateKbps} and ${LIMITS.maxBitrateKbps} kbps.`);
  }
  return kbps;
}

function parseResolution(value) {
  if (typeof value !== 'string') throw new OptionsError('resolution must be a string like "1080p" or "1280x720".');
  const named = RESOLUTIONS[value.toLowerCase()];
  if (named) return { ...named };
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(value);
  if (!match) {
    throw new OptionsError(
      `Unknown resolution "${value}". Use one of ${Object.keys(RESOLUTIONS).join(', ')} or "WIDTHxHEIGHT".`
    );
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function checkSize(name, value) {
  if (!Number.isInteger(value) || value < LIMITS.minSize || value > LIMITS.maxSize) {
    throw new OptionsError(`${name} must be a whole number between ${LIMITS.minSize} and ${LIMITS.maxSize}.`);
  }
  // yuv420p needs even dimensions
  return value - (value % 2);
}

/**
 * Turns user-facing quality options into concrete encoder settings.
 *
 * @param {import('../types').QualityOptions} options
 * @returns {{ width: number, height: number, fps: number, bitrate: number, quality: string, preset: string }}
 */
function resolveSettings(options) {
  const { resolution, width, height, fps, bitrate, quality } = options;

  let size;
  if (width !== undefined || height !== undefined) {
    if (width === undefined || height === undefined) {
      throw new OptionsError('width and height must be provided together.');
    }
    size = { width, height };
  } else {
    size = parseResolution(resolution);
  }
  const finalWidth = checkSize('width', size.width);
  const finalHeight = checkSize('height', size.height);

  if (!Number.isInteger(fps) || fps < LIMITS.minFps || fps > LIMITS.maxFps) {
    throw new OptionsError(`fps must be a whole number between ${LIMITS.minFps} and ${LIMITS.maxFps}.`);
  }

  const preset = QUALITY_PRESETS[quality];
  if (!preset) {
    throw new OptionsError(`Unknown quality "${quality}". Use one of ${Object.keys(QUALITY_PRESETS).join(', ')}.`);
  }

  const kbps =
    bitrate !== undefined && bitrate !== null
      ? parseBitrate(bitrate)
      : Math.min(
          LIMITS.maxBitrateKbps,
          Math.max(LIMITS.minBitrateKbps, Math.round((finalWidth * finalHeight * fps * preset.bitsPerPixel) / 1000))
        );

  return { width: finalWidth, height: finalHeight, fps, bitrate: kbps, quality, preset: preset.preset };
}

/**
 * @param {unknown} volume
 * @returns {number}
 */
function checkVolume(volume) {
  if (typeof volume !== 'number' || Number.isNaN(volume) || volume < 0 || volume > LIMITS.maxVolume) {
    throw new OptionsError(`volume must be a number between 0 and ${LIMITS.maxVolume} (1 = 100%).`);
  }
  return volume;
}

module.exports = { resolveSettings, parseBitrate, checkVolume };
