'use strict';

/**
 * This file only holds JSDoc typedefs so editors can offer autocomplete.
 * It exports nothing.
 *
 * @typedef {'low'|'medium'|'high'|'ultra'} QualityName
 *
 * @typedef {'360p'|'480p'|'720p'|'1080p'|'1440p'|'4k'|string} ResolutionName
 * A named resolution or a "WIDTHxHEIGHT" string.
 *
 * @typedef {string | { type: 'file'|'url'|'image'|'color'|'webpage', value: string }} SourceInput
 * Accepted source forms:
 *  - a file path                  "video.mp4", "./cover.png"
 *  - an http(s)/rtmp/rtsp URL     "https://example.com/video.mp4"
 *  - "black"                      a black screen
 *  - a hex color                  "#ff0000" or "color:#ff0000"
 *  - a web page                   "page:https://example.com" (needs puppeteer)
 *  - an explicit object           { type: 'color', value: '#00ff00' }
 *
 * @typedef {Object} QualityOptions
 * @property {ResolutionName} [resolution]  Named or "WxH" resolution.
 * @property {number} [width]               Output width in pixels (needs `height`).
 * @property {number} [height]              Output height in pixels (needs `width`).
 * @property {number} [fps]                 Frames per second, 1-60.
 * @property {number|string} [bitrate]      kbps as a number, or "4500k" / "4M".
 * @property {QualityName} [quality]        Encoder preset, default "medium".
 *
 * @typedef {Object} StartOptions
 * @property {import('discord.js').VoiceBasedChannel|string} channel  Voice channel or its ID.
 * @property {SourceInput} source
 * @property {boolean} [loop=false]
 * @property {boolean} [audio=true]         Play the source's audio track.
 * @property {boolean} [muted=false]
 * @property {number} [volume=1]            Multiplier from 0 to 2.
 * @property {boolean} [selfDeaf=true]      Join deafened, which is what most bots want.
 * @property {string} [ffmpegPath]          Use a specific ffmpeg binary.
 * @property {number} [connectTimeoutMs=20000]
 * @property {number} [sourceTimeoutMs=20000]
 * @property {{ captureFps?: number, waitUntil?: string, launchArgs?: string[] }} [webpage]
 *
 * @typedef {Object} VideoInfo
 * @property {'h264'} codec
 * @property {'annexb'} format    Raw H.264 Annex B byte stream.
 * @property {number} width
 * @property {number} height
 * @property {number} fps
 * @property {number} bitrate     kbps
 *
 * @typedef {'idle'|'starting'|'playing'|'paused'} Status
 */

module.exports = {};
