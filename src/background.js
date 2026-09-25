// background.js - MV3 service worker.
// Responsibilities:
//  - Relay the keyboard command (Ctrl+.) to the active tab's content script.
//  - Perform full-tab screen captures via chrome.tabs.captureVisibleTab and
//    return the data URL to the content script, which crops to element bounds.
//
// captureVisibleTab is used instead of html2canvas as the *primary* path
// because it produces a pixel-accurate raster of what the user actually sees
// (honoring transforms, canvas/video, cross-origin images, and devicePixelRatio).
// The content script crops the returned image to the element's bounding box.
// html2canvas is kept as a fallback (see capture.js) for cases where the
// element extends beyond the viewport or capture permission is unavailable.

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-annotation') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'ANNOTATOR_TOGGLE' });
    } catch (e) {
      // Content script may not be injected (e.g. chrome:// pages). Ignore.
      console.warn('Annotator: could not reach content script:', e);
    }
  }
});

// Allow the popup to toggle annotation mode on the active tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ANNOTATOR_TOGGLE_FROM_POPUP') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab && tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: 'ANNOTATOR_TOGGLE' }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg && msg.type === 'ANNOTATOR_CAPTURE_VISIBLE') {
    // Capture the visible area of the tab the request came from.
    const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true; // keep the message channel open for the async response
  }

  return false;
});
