/**
 * AceLC - Popup Script
 * Initializes popup interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
  console.log('[AceLC Popup] Initialized successfully.');

  const openOptionsBtn = document.getElementById('openOptionsBtn');

  if (openOptionsBtn) {
    openOptionsBtn.addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('Options/options.html'));
      }
    });
  }
});
