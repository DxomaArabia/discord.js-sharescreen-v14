'use strict';

const { DependencyError, SourceError } = require('../errors');

function loadPuppeteer() {
  for (const name of ['puppeteer', 'puppeteer-core']) {
    try {
      return require(name);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  throw new DependencyError(
    'Streaming a web page needs a headless browser. Install one with "npm install puppeteer" and try again.'
  );
}

/**
 * Renders a web page with a headless browser and feeds JPEG screenshots
 * into a writable stream (ffmpeg's stdin).
 */
class WebCapture {
  /**
   * @param {{ url: string, width: number, height: number, captureFps: number, waitUntil: string, launchArgs: string[] }} options
   */
  constructor(options) {
    this.options = options;
    this.browser = null;
    this.running = false;
  }

  /**
   * Opens the page. Resolves once the page has loaded.
   * @returns {Promise<void>}
   */
  async open() {
    const puppeteer = loadPuppeteer();
    const { url, width, height, waitUntil, launchArgs } = this.options;
    try {
      this.browser = await puppeteer.launch({ headless: true, args: launchArgs });
      this.page = await this.browser.newPage();
      await this.page.setViewport({ width, height });
      await this.page.goto(url, { waitUntil, timeout: 30000 });
    } catch (err) {
      await this.close();
      throw new SourceError(`Could not load the web page ${url}: ${err.message}`, 'SOURCE_INVALID', { cause: err });
    }
  }

  /**
   * Starts pushing screenshots into `target` until `close()` is called.
   * @param {import('node:stream').Writable} target
   */
  pump(target) {
    this.running = true;
    const interval = 1000 / this.options.captureFps;

    (async () => {
      while (this.running && !target.destroyed) {
        const started = Date.now();
        try {
          const frame = await this.page.screenshot({ type: 'jpeg', quality: 80 });
          if (!this.running || target.destroyed) break;
          if (!target.write(frame)) {
            await new Promise((resolve) => target.once('drain', resolve));
          }
        } catch {
          break; // page or browser was closed
        }
        const wait = interval - (Date.now() - started);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      try { target.end(); } catch { /* already closed */ }
    })();
  }

  async close() {
    this.running = false;
    const browser = this.browser;
    this.browser = null;
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { WebCapture };
