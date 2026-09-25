// overlay.js - hover highlight overlay + capture/extraction logic.
// Exposes window.__AnnotatorOverlay used by content.js.
//
// Provides:
//  - highlight box that follows the hovered element (DevTools-style)
//  - dimension + tag label
//  - extraction of HTML, meaningful CSS, robust selector, framework hints
//  - markdown + JSON serialization

(function () {
  'use strict';

  // Computed-style properties we consider "meaningful" for AI hand-off.
  const MEANINGFUL_PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'width', 'height', 'margin', 'padding',
    'border', 'border-radius', 'box-shadow', 'outline',
    'background', 'background-color', 'color', 'opacity',
    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
    'gap', 'flex', 'flex-direction', 'justify-content', 'align-items',
    'grid', 'grid-template-columns', 'grid-template-rows',
    'cursor', 'transform', 'transition', 'overflow',
  ];

  // Values that are effectively browser defaults / noise we drop.
  const NOISE_VALUES = new Set(['', 'none', 'auto', 'normal', '0px', 'rgba(0, 0, 0, 0)', 'static', 'visible']);

  let box = null;
  let label = null;

  function ensureOverlay() {
    if (box) return;
    box = document.createElement('div');
    box.className = 'annotator-highlight';
    label = document.createElement('div');
    label.className = 'annotator-label';
    box.appendChild(label);
    document.documentElement.appendChild(box);
  }

  function showHighlight(el) {
    ensureOverlay();
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.top = r.top + 'px';
    box.style.left = r.left + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    const tag = el.tagName.toLowerCase();
    label.textContent = `${tag}  ${Math.round(r.width)} × ${Math.round(r.height)}`;
  }

  function hideHighlight() {
    if (box) box.style.display = 'none';
  }

  function destroyHighlight() {
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
    label = null;
  }

  // ---- Selector generation -------------------------------------------------
  function cssEscape(str) {
    if (window.CSS && CSS.escape) return CSS.escape(str);
    return String(str).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  function buildSelector(el) {
    // 1) unique id
    if (el.id && isUnique('#' + cssEscape(el.id))) {
      return '#' + cssEscape(el.id);
    }
    // 2) data-testid
    const testid = el.getAttribute && el.getAttribute('data-testid');
    if (testid) {
      const sel = `[data-testid="${testid}"]`;
      if (isUnique(sel)) return sel;
    }
    // 3) any other data-* attribute
    if (el.attributes) {
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-') && attr.name !== 'data-testid' && attr.value) {
          const sel = `[${attr.name}="${attr.value}"]`;
          if (isUnique(sel)) return sel;
        }
      }
    }
    // 4) unique class chain on the element itself
    if (el.classList && el.classList.length) {
      const classSel = '.' + Array.from(el.classList).map(cssEscape).join('.');
      if (isUnique(classSel)) return classSel;
    }
    // 5) nth-child path fallback
    return nthChildPath(el);
  }

  function nthChildPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentNode;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) {
          const idx = sameTag.indexOf(node) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(part);
      if (node.id && isUnique('#' + cssEscape(node.id))) {
        parts[0] = '#' + cssEscape(node.id);
        break;
      }
      node = node.parentNode;
    }
    return parts.join(' > ');
  }

  // ---- CSS extraction ------------------------------------------------------
  function extractCss(el) {
    const computed = window.getComputedStyle(el);
    const lines = [];
    for (const prop of MEANINGFUL_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (!value) continue;
      const v = value.trim();
      if (NOISE_VALUES.has(v)) continue;
      lines.push(`  ${prop}: ${v};`);
    }
    return lines.join('\n');
  }

  // ---- Framework hints -----------------------------------------------------
  function reactComponentName(el) {
    const key = Object.keys(el).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    );
    if (!key) return null;
    let fiber = el[key];
    // Walk up until we find a function/class component with a name.
    while (fiber) {
      const t = fiber.type;
      if (typeof t === 'function') return t.displayName || t.name || null;
      if (t && typeof t === 'object' && (t.displayName || t.name)) return t.displayName || t.name;
      fiber = fiber.return;
    }
    return null;
  }

  function tailwindClasses(el) {
    if (!el.classList || !el.classList.length) return [];
    // Heuristic: tailwind utilities are short, lowercase, often contain '-' or ':'.
    const tw = /^(-?[a-z0-9]+(:[a-z0-9-]+)*)(\/[0-9]+)?$/;
    return Array.from(el.classList).filter((c) => tw.test(c) && c.length <= 30);
  }

  // ---- Aggregate extraction ------------------------------------------------
  function extract(el) {
    const selector = buildSelector(el);
    const html = el.outerHTML;
    const css = extractCss(el);
    const react = reactComponentName(el);
    const tw = tailwindClasses(el);
    return { selector, html, css, react, tailwind: tw, tag: el.tagName.toLowerCase() };
  }

  function toMarkdown(data, hasScreenshot) {
    let md = '# Selected Element\n\n';
    md += hasScreenshot ? 'Screenshot captured.\n\n' : '';
    if (data.react) md += `**React component:** \`${data.react}\`\n\n`;
    if (data.tailwind && data.tailwind.length) {
      md += `**Tailwind classes:** \`${data.tailwind.join(' ')}\`\n\n`;
    }
    md += '## Selector\n\n```css\n' + data.selector + '\n```\n\n';
    md += '## HTML\n\n```html\n' + data.html + '\n```\n\n';
    md += '## CSS\n\n```css\n' + data.selector + ' {\n' + data.css + '\n}\n```\n';
    return md;
  }

  function toJson(data, hasScreenshot) {
    return JSON.stringify(
      {
        tag: data.tag,
        selector: data.selector,
        html: data.html,
        css: data.css,
        react: data.react,
        tailwind: data.tailwind,
        screenshot: hasScreenshot,
      },
      null,
      2
    );
  }

  window.__AnnotatorOverlay = {
    showHighlight,
    hideHighlight,
    destroyHighlight,
    extract,
    toMarkdown,
    toJson,
  };
})();
