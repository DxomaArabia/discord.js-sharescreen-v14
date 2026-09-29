'use strict';

const { SourceError } = require('../errors');

/**
 * Resolves as soon as one runner produces data. Rejects when every runner
 * exits without producing anything, or when the timeout elapses.
 *
 * @param {import('../core/runner').FFmpegRunner[]} runners
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForFirstData(runners, timeoutMs) {
  if (runners.length === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    let remaining = runners.length;
    const failures = [];

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(
        reject,
        new SourceError(
          `The source did not produce any data within ${timeoutMs} ms. It may be unreachable or too slow to open.`,
          'SOURCE_TIMEOUT'
        )
      );
    }, timeoutMs);

    for (const runner of runners) {
      if (runner.hadData) return finish(resolve);
      runner.once('first', () => finish(resolve));
      runner.once('exit', (info) => {
        if (settled) return;
        failures.push({ runner, info });
        if (--remaining === 0) {
          const video = failures.find((f) => f.runner.label === 'video') || failures[0];
          finish(
            reject,
            video.info.error ||
              new SourceError('The source ended without producing any data.', 'SOURCE_EMPTY')
          );
        }
      });
    }
  });
}

module.exports = { waitForFirstData };
