'use strict';

const { ShareScreen } = require('./src/ShareScreen');
const errors = require('./src/errors');
const { RESOLUTIONS, QUALITY_PRESETS, DEFAULTS } = require('./config/defaults');
const { locateFFmpeg } = require('./src/core/ffmpeg');

module.exports = {
  ShareScreen,
  ...errors,
  RESOLUTIONS,
  QUALITY_PRESETS,
  DEFAULTS,
  locateFFmpeg,
};
