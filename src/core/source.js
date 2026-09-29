'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { OptionsError, SourceError } = require('../errors');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const MEDIA_EXT = new Set([
  '.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.flv', '.ts', '.m3u8', '.mpd', '.gif',
  '.mp3', '.ogg', '.opus', '.wav', '.flac', '.m4a', '.aac',
]);
const STREAM_PROTOCOLS = new Set(['rtmp:', 'rtmps:', 'rtsp:']);
const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * @typedef {Object} ResolvedSource
 * @property {'file'|'url'|'image'|'color'|'webpage'} type
 * @property {string} value   Path, URL or ffmpeg color string ("0xRRGGBB").
 * @property {string} label   Human readable description.
 * @property {boolean} hasAudio  Whether the source can carry audio.
 * @property {boolean} seekable  Whether -ss / looping make sense.
 */

function normalizeHex(input) {
  const match = HEX_COLOR.exec(input.trim());
  if (!match) {
    throw new OptionsError(`"${input}" is not a valid hex color. Use something like "#ff0000" or "#f00".`, 'INVALID_COLOR');
  }
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  return hex.toLowerCase();
}

function colorSource(input) {
  if (input.trim().toLowerCase() === 'black') {
    return { type: 'color', value: '0x000000', label: 'black screen', hasAudio: false, seekable: false };
  }
  const hex = normalizeHex(input);
  return { type: 'color', value: `0x${hex}`, label: `color #${hex}`, hasAudio: false, seekable: false };
}

function urlSource(raw, forceType) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceError(`"${raw}" is not a valid URL.`, 'SOURCE_INVALID');
  }
  const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
  if (!isHttp && !STREAM_PROTOCOLS.has(url.protocol)) {
    throw new SourceError(`Unsupported protocol "${url.protocol}". Use http, https, rtmp, rtmps or rtsp.`, 'SOURCE_UNSUPPORTED');
  }

  const ext = path.extname(url.pathname).toLowerCase();
  if (forceType === 'webpage' || (isHttp && !IMAGE_EXT.has(ext) && !MEDIA_EXT.has(ext) && forceType !== 'url')) {
    if (!isHttp) throw new SourceError('Only http and https pages can be rendered as web pages.', 'SOURCE_UNSUPPORTED');
    return { type: 'webpage', value: url.href, label: `web page ${url.href}`, hasAudio: false, seekable: false };
  }
  if (IMAGE_EXT.has(ext) && forceType !== 'url') {
    return { type: 'image', value: url.href, label: `image ${url.href}`, hasAudio: false, seekable: false };
  }
  return { type: 'url', value: url.href, label: url.href, hasAudio: true, seekable: isHttp };
}

async function fileSource(raw, forceType) {
  const absolute = path.resolve(raw);
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch (err) {
    throw new SourceError(`File not found: ${absolute}`, 'SOURCE_NOT_FOUND', { cause: err });
  }
  if (!stat.isFile()) throw new SourceError(`${absolute} is not a file.`, 'SOURCE_INVALID');
  try {
    await fs.access(absolute, require('node:fs').constants.R_OK);
  } catch (err) {
    throw new SourceError(`No permission to read ${absolute}`, 'SOURCE_UNREADABLE', { cause: err });
  }

  const isImage = forceType === 'image' || (forceType !== 'file' && IMAGE_EXT.has(path.extname(absolute).toLowerCase()));
  if (isImage) {
    return { type: 'image', value: absolute, label: `image ${path.basename(absolute)}`, hasAudio: false, seekable: false };
  }
  return { type: 'file', value: absolute, label: path.basename(absolute), hasAudio: true, seekable: true };
}

/**
 * Works out what kind of source the caller gave us and validates it.
 *
 * @param {import('../types').SourceInput} input
 * @returns {Promise<ResolvedSource>}
 */
async function resolveSource(input) {
  let type;
  let value;

  if (input && typeof input === 'object') {
    type = input.type;
    value = input.value;
    if (!['file', 'url', 'image', 'color', 'webpage'].includes(type) || typeof value !== 'string' || !value) {
      throw new OptionsError('A source object must look like { type: "file"|"url"|"image"|"color"|"webpage", value: "..." }.');
    }
  } else if (typeof input === 'string' && input.trim()) {
    value = input.trim();
  } else {
    throw new OptionsError('source is required. Pass a file path, URL, "black" or a hex color like "#ff0000".');
  }

  if (!type) {
    if (/^color:/i.test(value)) return colorSource(value.slice(6));
    if (/^page:/i.test(value)) return urlSource(value.slice(5), 'webpage');
    if (value.toLowerCase() === 'black' || value.startsWith('#')) return colorSource(value);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return urlSource(value);
    return fileSource(value);
  }

  switch (type) {
    case 'color': return colorSource(value);
    case 'webpage': return urlSource(value, 'webpage');
    case 'url': return urlSource(value, 'url');
    case 'image': return /^https?:\/\//i.test(value) ? urlSource(value) : fileSource(value, 'image');
    default: return fileSource(value, 'file');
  }
}

module.exports = { resolveSource };
