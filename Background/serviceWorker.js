/**
 * AceLC - Background Service Worker
 * Manages extension state, cross-component messaging, and upload pipelines.
 */

// Load shared constants into service worker scope
try {
  importScripts('../Shared/constants.js');
} catch (error) {
  console.error('[AceLC Background] Failed to load constants:', error);
}

/**
 * Handle extension installation or update
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[AceLC Background] Extension installed/updated. Reason:', details.reason);

  // Initialize default storage values if not already present
  chrome.storage.local.get(
    [
      AceConstants.STORAGE_KEYS.IS_ACTIVATED,
      AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS
    ],
    (result) => {
      const updates = {};

      if (typeof result[AceConstants.STORAGE_KEYS.IS_ACTIVATED] === 'undefined') {
        updates[AceConstants.STORAGE_KEYS.IS_ACTIVATED] = false;
      }

      if (!Array.isArray(result[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS])) {
        updates[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS] = [];
      }

      if (Object.keys(updates).length > 0) {
        chrome.storage.local.set(updates, () => {
          console.log('[AceLC Background] Initial state configured in storage.');
        });
      }
    }
  );
});

/**
 * Handle incoming runtime messages
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[AceLC Background] Received message:', message);

  // Validate incoming message structure
  if (!message || typeof message.action !== 'string') {
    sendResponse({ success: false, error: 'Invalid message structure' });
    return false;
  }

  if (message.action === AceConstants.MESSAGES.GET_STATUS) {
    sendResponse({
      success: true,
      name: AceConstants.EXTENSION_NAME,
      version: AceConstants.VERSION,
      phase: 'Phase 1: Project Foundation'
    });
    return false;
  }

  sendResponse({ success: false, error: 'Unhandled action' });
  return false;
});
