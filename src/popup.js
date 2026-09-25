// popup.js - toolbar popup. Sends a toggle request to the active tab.
const btn = document.getElementById('toggle');
btn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'ANNOTATOR_TOGGLE_FROM_POPUP' }, () => {
    window.close();
  });
});
