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
    AUTH_STATE: 'ace_auth_state',
    CLIENT_ID: 'ace_github_client_id',
    SELECTED_REPO: 'ace_selected_repo',
    DESTINATION_FOLDERS: 'ace_destination_folders',
    IS_ACTIVATED: 'ace_is_activated',
    PENDING_SUBMISSION: 'ace_pending_submission'
  },

  // Authentication UI and process states
  AUTH_STATUS: {
    NOT_CONNECTED: 'NOT_CONNECTED',
    WAITING_FOR_AUTH: 'WAITING_FOR_AUTH',
    CONNECTED: 'CONNECTED',
    FAILED: 'FAILED'
  },

  // Message action identifiers used for chrome.runtime messaging
  MESSAGES: {
    // Authentication actions
    START_AUTH: 'ACE_START_AUTH',
    CANCEL_AUTH: 'ACE_CANCEL_AUTH',
    CHECK_AUTH_NOW: 'ACE_CHECK_AUTH_NOW',
    DISCONNECT_AUTH: 'ACE_DISCONNECT_AUTH',
    GET_AUTH_STATUS: 'ACE_GET_AUTH_STATUS',

    // Repository actions (Phase 3)
    GET_REPOSITORIES: 'ACE_GET_REPOSITORIES',
    CREATE_REPOSITORY: 'ACE_CREATE_REPOSITORY',
    SELECT_REPOSITORY: 'ACE_SELECT_REPOSITORY',
    GET_SELECTED_REPO: 'ACE_GET_SELECTED_REPO',

    // Folder actions (Phase 4)
    GET_REPO_DIRECTORIES: 'ACE_GET_REPO_DIRECTORIES',
    GET_DESTINATION_FOLDERS: 'ACE_GET_DESTINATION_FOLDERS',
    ADD_DESTINATION_FOLDER: 'ACE_ADD_DESTINATION_FOLDER',
    REMOVE_DESTINATION_FOLDER: 'ACE_REMOVE_DESTINATION_FOLDER',
    SET_DESTINATION_FOLDERS: 'ACE_SET_DESTINATION_FOLDERS',

    // Core actions
    SUBMISSION_DETECTED: 'ACE_SUBMISSION_DETECTED',
    GET_STATUS: 'ACE_GET_STATUS',
    UPLOAD_SOLUTION: 'ACE_UPLOAD_SOLUTION'
  },

  // GitHub OAuth & REST API configuration
  GITHUB: {
    DEFAULT_CLIENT_ID: '', // Optional default OAuth App Client ID
    DEVICE_CODE_URL: 'https://github.com/login/device/code',
    TOKEN_URL: 'https://github.com/login/oauth/access_token',
    USER_API_URL: 'https://api.github.com/user',
    USER_REPOS_URL: 'https://api.github.com/user/repos',
    REPOS_API_URL: 'https://api.github.com/repos',
    SCOPES: 'repo',
    VERIFICATION_URL: 'https://github.com/login/device'
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
