/**
 * AceLC - GitHub Auth Bridge Content Script
 * Runs at document_start on github.com to capture OAuth redirect codes immediately.
 */
(() => {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('code')) {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (code) {
        chrome.runtime.sendMessage({
          action: (typeof AceConstants !== 'undefined' && AceConstants.MESSAGES && AceConstants.MESSAGES.GITHUB_AUTH_CODE) || 'ACE_GITHUB_AUTH_CODE',
          code: code,
          state: state
        });
      }
    }
  } catch (err) {
    console.warn('[AceLC Auth Bridge] Error inspecting URL for OAuth code:', err);
  }
})();
