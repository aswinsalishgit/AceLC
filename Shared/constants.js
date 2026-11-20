/**
 * AceLC - Shared Constants
 * Contains shared configuration, storage keys, and message identifiers
 * used across the background service worker, popup, options, and content scripts.
 */

const AceConstants = Object.freeze({
  EXTENSION_NAME: 'AceLC',
  VERSION: '1.0.0',

  // Keys used for chrome.storage.local persistence
  STORAGE_KEYS: {
    AUTH_TOKEN: 'ace_github_token',
    USER_INFO: 'ace_github_user',
    SELECTED_REPO: 'ace_selected_repo',
    DESTINATION_FOLDERS: 'ace_destination_folders',
    IS_ACTIVATED: 'ace_is_activated',
    PENDING_SUBMISSION: 'ace_pending_submission'
  },

  // Message action identifiers used for chrome.runtime messaging
  MESSAGES: {
    SUBMISSION_DETECTED: 'ACE_SUBMISSION_DETECTED',
    GET_STATUS: 'ACE_GET_STATUS',
    UPLOAD_SOLUTION: 'ACE_UPLOAD_SOLUTION'
  },

  // Target URLs
  URLS: {
    LEETCODE_MATCH: 'https://leetcode.com/problems/*'
  }
});

// Expose on globalThis so it is accessible in all extension execution contexts
if (typeof globalThis !== 'undefined') {
  globalThis.AceConstants = AceConstants;
}
