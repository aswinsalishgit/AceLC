/**
 * AceLC - LeetCode Content Script
 * Observes problem pages to detect accepted solution submissions.
 * Detailed detection will be added in Phase 5.
 */

(() => {
  console.log('[AceLC Content] Script loaded on page:', window.location.href);

  // Check shared constants availability
  if (typeof AceConstants !== 'undefined') {
    console.log(`[AceLC Content] Connected with ${AceConstants.EXTENSION_NAME} v${AceConstants.VERSION}`);
  } else {
    console.warn('[AceLC Content] Shared constants not found.');
  }
})();
