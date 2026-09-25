// capture.js - capture helpers exposed on window.__AnnotatorCapture.
// Loaded as a content script before overlay.js / content.js.
//
// Strategy:
//  1) PRIMARY: ask the background worker to captureVisibleTab, then crop the
//     returned PNG to the element's bounding rect (scaled by devicePixelRatio).
//     This is the most reliable for transforms, video, canvas, and cross-origin
//     images because it rasterizes the real composited viewport.
//  2) FALLBACK: html2canvas, used when the element is partly/fully outside the
//     viewport or when captureVisibleTab is unavailable.

(function () {
  'use strict';

  /**
   * Crop a full-viewport PNG data URL to the given client rect.
   * @param {string} dataUrl - PNG of the visible tab.
   * @param {DOMRect} rect - element.getBoundingClientRect() (CSS pixels).
   * @returns {Promise<string>} cropped PNG data URL.
   */
  function cropToRect(dataUrl, rect) {
    return new Promise((resolve, reject) => {
      const dpr = window.devicePixelRatio || 1;
      const img = new Image();
      img.onload = () => {
        // captureVisibleTab returns an image at device-pixel resolution.
        const sx = Math.max(0, Math.floor(rect.left * dpr));
        const sy = Math.max(0, Math.floor(rect.top * dpr));
        const sw = Math.max(1, Math.floor(rect.width * dpr));
        const sh = Math.max(1, Math.floor(rect.height * dpr));
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        try {
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Capture a single element to a PNG data URL.
   * @param {Element} el
   * @returns {Promise<string|null>}
   */
  async function captureElement(el) {
    const rect = el.getBoundingClientRect();
    const inViewport =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth;

    // PRIMARY path: captureVisibleTab + crop, when fully in view.
    if (inViewport) {
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'ANNOTATOR_CAPTURE_VISIBLE' });
        if (resp && resp.ok && resp.dataUrl) {
          return await cropToRect(resp.dataUrl, rect);
        }
      } catch (e) {
        console.warn('Annotator: captureVisibleTab failed, falling back.', e);
      }
    }

    // FALLBACK path: html2canvas (handles off-screen / oversized elements).
    if (typeof window.html2canvas === 'function') {
      try {
        const canvas = await window.html2canvas(el, {
          backgroundColor: null,
          logging: false,
          scale: window.devicePixelRatio || 1,
          useCORS: true,
        });
        return canvas.toDataURL('image/png');
      } catch (e) {
        console.warn('Annotator: html2canvas failed.', e);
      }
    }

    return null;
  }

  window.__AnnotatorCapture = { captureElement, cropToRect };
})();
