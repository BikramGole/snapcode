// content.js - orchestrates annotation mode, event handling, and the modal.
// Depends on window.__AnnotatorOverlay (overlay.js) and
// window.__AnnotatorCapture (capture.js).

(function () {
  'use strict';

  const Overlay = window.__AnnotatorOverlay;
  const Capture = window.__AnnotatorCapture;

  let active = false;
  let hovered = null;
  let tooltip = null;
  let modal = null;
  let lastData = null;
  let lastScreenshot = null;

  // ---- Annotation mode lifecycle ------------------------------------------
  function enable() {
    if (active) return;
    active = true;
    document.documentElement.style.cursor = 'crosshair';
    showTooltip('Click an element to capture');
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function disable() {
    if (!active) return;
    active = false;
    document.documentElement.style.cursor = '';
    Overlay.hideHighlight();
    hideTooltip();
    hovered = null;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function toggle() {
    active ? disable() : enable();
  }

  // ---- Event handlers ------------------------------------------------------
  function onMouseMove(e) {
    if (!active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === hovered || isAnnotatorNode(el)) return;
    hovered = el;
    Overlay.showHighlight(el);
  }

  async function onClick(e) {
    if (!active) return;
    if (isAnnotatorNode(e.target)) return; // allow clicks inside our own UI
    e.preventDefault();
    e.stopPropagation();
    const el = hovered || document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    await captureAndShow(el);
  }

  function onKeyDown(e) {
    // ESC exits annotation mode. Ctrl+. fallback toggle (if command missed).
    if (e.key === 'Escape') {
      e.preventDefault();
      disable();
    } else if (e.ctrlKey && e.key === '.') {
      e.preventDefault();
      toggle();
    }
  }

  // ---- Capture + show modal ------------------------------------------------
  async function captureAndShow(el) {
    Overlay.hideHighlight();
    const data = Overlay.extract(el);
    let screenshot = null;
    try {
      screenshot = await Capture.captureElement(el);
    } catch (err) {
      console.warn('Annotator: capture failed', err);
    }
    lastData = data;
    lastScreenshot = screenshot;

    // Auto-copy markdown to clipboard.
    const md = Overlay.toMarkdown(data, !!screenshot);
    copyText(md);
    if (screenshot) copyImage(screenshot).catch(() => {});

    disable();
    openModal(data, screenshot);
  }

  // ---- Clipboard helpers ---------------------------------------------------
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  async function copyImage(dataUrl) {
    if (!navigator.clipboard || !window.ClipboardItem) return;
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  function download(filename, dataUrl) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ---- Tooltip -------------------------------------------------------------
  function showTooltip(text) {
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'annotator-tooltip';
      document.documentElement.appendChild(tooltip);
    }
    tooltip.textContent = text;
    tooltip.style.display = 'block';
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
  }

  // ---- Modal ---------------------------------------------------------------
  function isAnnotatorNode(el) {
    return !!(el && el.closest && el.closest('.annotator-modal, .annotator-tooltip, .annotator-highlight'));
  }

  function openModal(data, screenshot) {
    closeModal();
    modal = document.createElement('div');
    modal.className = 'annotator-modal';
    modal.innerHTML = `
      <div class="annotator-modal__panel">
        <div class="annotator-modal__header">
          <span>Annotator — ${data.tag}</span>
          <button class="annotator-btn annotator-close" data-act="close">✕</button>
        </div>
        <div class="annotator-modal__preview">
          ${screenshot ? `<img src="${screenshot}" alt="element screenshot"/>` : '<div class="annotator-noshot">No screenshot available</div>'}
        </div>
        <div class="annotator-tabs">
          <button class="annotator-tab is-active" data-tab="html">HTML</button>
          <button class="annotator-tab" data-tab="css">CSS</button>
          <button class="annotator-tab" data-tab="selector">Selector</button>
        </div>
        <pre class="annotator-pane" data-pane="html"></pre>
        <pre class="annotator-pane" data-pane="css" hidden></pre>
        <pre class="annotator-pane" data-pane="selector" hidden></pre>
        <div class="annotator-actions">
          <button class="annotator-btn" data-act="md">Copy Markdown</button>
          <button class="annotator-btn" data-act="html">Copy HTML</button>
          <button class="annotator-btn" data-act="css">Copy CSS</button>
          <button class="annotator-btn" data-act="selector">Copy Selector</button>
          <button class="annotator-btn" data-act="json">Copy JSON</button>
          <button class="annotator-btn" data-act="save" ${screenshot ? '' : 'disabled'}>Save Screenshot</button>
        </div>
      </div>`;
    document.documentElement.appendChild(modal);

    // Populate panes (textContent avoids HTML injection).
    modal.querySelector('[data-pane="html"]').textContent = data.html;
    modal.querySelector('[data-pane="css"]').textContent = `${data.selector} {\n${data.css}\n}`;
    modal.querySelector('[data-pane="selector"]').textContent = data.selector;

    // Tab switching.
    modal.querySelectorAll('.annotator-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        modal.querySelectorAll('.annotator-tab').forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        const which = tab.getAttribute('data-tab');
        modal.querySelectorAll('.annotator-pane').forEach((p) => {
          p.hidden = p.getAttribute('data-pane') !== which;
        });
      });
    });

    // Action buttons.
    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'close') return closeModal();
      if (act === 'md') return copyText(Overlay.toMarkdown(data, !!screenshot));
      if (act === 'html') return copyText(data.html);
      if (act === 'css') return copyText(`${data.selector} {\n${data.css}\n}`);
      if (act === 'selector') return copyText(data.selector);
      if (act === 'json') return copyText(Overlay.toJson(data, !!screenshot));
      if (act === 'save' && screenshot) return download('element.png', screenshot);
    });
  }

  function closeModal() {
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    modal = null;
  }

  // ---- Message bridge ------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'ANNOTATOR_TOGGLE') toggle();
  });
})();
