'use strict';

/**
 * Turns the tail of ffmpeg's stderr into a sentence a human can act on.
 * @param {string} stderr
 * @returns {string}
 */
function explainFFmpegFailure(stderr) {
  const text = String(stderr || '').trim();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1] || 'ffmpeg exited without an error message';

  if (/No such file or directory/i.test(text)) return 'the file does not exist or cannot be read';
  if (/Permission denied/i.test(text)) return 'permission denied while opening the source';
  if (/Invalid data found when processing input/i.test(text)) return 'the source is not a valid or supported media file';
  if (/Server returned 4\d\d|HTTP error 4\d\d/i.test(text)) return `the server refused the request (${last})`;
  if (/Server returned 5\d\d|HTTP error 5\d\d/i.test(text)) return `the server failed to respond correctly (${last})`;
  if (/Connection refused|timed out|Name or service not known|Failed to resolve|Could not resolve/i.test(text)) {
    return `the source could not be reached over the network (${last})`;
  }
  if (/does not contain any stream|Output file is empty/i.test(text)) return 'the source has no usable audio or video stream';
  if (/Unrecognized option|Error parsing options/i.test(text)) return `ffmpeg rejected the arguments (${last})`;
  return last;
}

module.exports = { explainFFmpegFailure };
