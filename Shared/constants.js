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
    PENDING_SUBMISSION: 'ace_pending_submission',
    PENDING_SUBMISSION_QUEUE: 'ace_pending_submission_queue',
    CONFIRMED_SUBMISSIONS: 'ace_confirmed_submissions'
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

    // Submission actions (Phase 5)
    SUBMISSION_DETECTED: 'ACE_SUBMISSION_DETECTED',
    GET_PENDING_SUBMISSION: 'ACE_GET_PENDING_SUBMISSION',
    CLEAR_PENDING_SUBMISSION: 'ACE_CLEAR_PENDING_SUBMISSION',

    // Destination Selection actions (Phase 6)
    SHOW_DESTINATION_MODAL: 'ACE_SHOW_DESTINATION_MODAL',
    GET_PENDING_QUEUE: 'ACE_GET_PENDING_QUEUE',
    CONFIRM_DESTINATION_SELECTION: 'ACE_CONFIRM_DESTINATION_SELECTION',
    CANCEL_DESTINATION_SELECTION: 'ACE_CANCEL_DESTINATION_SELECTION',

    // Core actions
    GET_STATUS: 'ACE_GET_STATUS',
    UPLOAD_SOLUTION: 'ACE_UPLOAD_SOLUTION'
  },

  // In-page Bridge Event names for main-world communication
  BRIDGE_EVENTS: {
    SUBMISSION_INITIATED: 'ACE_BRIDGE_SUBMISSION_INITIATED',
    SUBMISSION_ID_ASSIGNED: 'ACE_BRIDGE_SUBMISSION_ID_ASSIGNED',
    SUBMISSION_PENDING: 'ACE_BRIDGE_SUBMISSION_PENDING',
    SUBMISSION_ACCEPTED: 'ACE_BRIDGE_SUBMISSION_ACCEPTED',
    SUBMISSION_FAILED: 'ACE_BRIDGE_SUBMISSION_FAILED',
    REQUEST_MONACO_CODE: 'ACE_BRIDGE_REQUEST_MONACO_CODE',
    RESPONSE_MONACO_CODE: 'ACE_BRIDGE_RESPONSE_MONACO_CODE',
    URL_CHANGED: 'ACE_BRIDGE_URL_CHANGED'
  },

  // LeetCode Programming Language mappings (normalized id -> display name & extension)
  LANGUAGES: Object.freeze({
    cpp: { id: 'cpp', name: 'C++', ext: '.cpp' },
    java: { id: 'java', name: 'Java', ext: '.java' },
    python: { id: 'python', name: 'Python', ext: '.py' },
    python3: { id: 'python3', name: 'Python3', ext: '.py' },
    c: { id: 'c', name: 'C', ext: '.c' },
    csharp: { id: 'csharp', name: 'C#', ext: '.cs' },
    javascript: { id: 'javascript', name: 'JavaScript', ext: '.js' },
    typescript: { id: 'typescript', name: 'TypeScript', ext: '.ts' },
    php: { id: 'php', name: 'PHP', ext: '.php' },
    swift: { id: 'swift', name: 'Swift', ext: '.swift' },
    kotlin: { id: 'kotlin', name: 'Kotlin', ext: '.kt' },
    dart: { id: 'dart', name: 'Dart', ext: '.dart' },
    golang: { id: 'golang', name: 'Go', ext: '.go' },
    go: { id: 'golang', name: 'Go', ext: '.go' },
    ruby: { id: 'ruby', name: 'Ruby', ext: '.rb' },
    scala: { id: 'scala', name: 'Scala', ext: '.scala' },
    rust: { id: 'rust', name: 'Rust', ext: '.rs' },
    racket: { id: 'racket', name: 'Racket', ext: '.rkt' },
    erlang: { id: 'erlang', name: 'Erlang', ext: '.erl' },
    elixir: { id: 'elixir', name: 'Elixir', ext: '.ex' },
    pypy3: { id: 'pypy3', name: 'PyPy3', ext: '.py' }
  }),

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

/**
 * Normalize and retrieve language details from a raw language identifier or UI text
 * @param {string} raw
 * @returns {{ id: string, name: string, ext: string }}
 */
function normalizeAceLanguage(raw) {
  if (!raw || typeof raw !== 'string') {
    return { id: 'unknown', name: 'Text', ext: '.txt' };
  }

  const clean = raw.trim().toLowerCase().replace(/\s+/g, '');

  // Direct lookup
  if (AceConstants.LANGUAGES[clean]) {
    return AceConstants.LANGUAGES[clean];
  }

  // Name matching
  for (const key of Object.keys(AceConstants.LANGUAGES)) {
    const lang = AceConstants.LANGUAGES[key];
    if (lang.name.toLowerCase().replace(/\s+/g, '') === clean) {
      return lang;
    }
  }

  // Common UI aliases
  if (clean.includes('python3') || clean === 'py3') return AceConstants.LANGUAGES.python3;
  if (clean.includes('python') || clean === 'py') return AceConstants.LANGUAGES.python;
  if (clean === 'c++' || clean === 'cpp') return AceConstants.LANGUAGES.cpp;
  if (clean === 'c#' || clean === 'csharp' || clean === 'cs') return AceConstants.LANGUAGES.csharp;
  if (clean.includes('javascript') || clean === 'js') return AceConstants.LANGUAGES.javascript;
  if (clean.includes('typescript') || clean === 'ts') return AceConstants.LANGUAGES.typescript;
  if (clean.includes('golang') || clean === 'go') return AceConstants.LANGUAGES.golang;
  if (clean === 'c') return AceConstants.LANGUAGES.c;
  if (clean === 'java') return AceConstants.LANGUAGES.java;
  if (clean === 'rust' || clean === 'rs') return AceConstants.LANGUAGES.rust;
  if (clean === 'kotlin' || clean === 'kt') return AceConstants.LANGUAGES.kotlin;
  if (clean === 'swift') return AceConstants.LANGUAGES.swift;
  if (clean === 'ruby' || clean === 'rb') return AceConstants.LANGUAGES.ruby;
  if (clean === 'php') return AceConstants.LANGUAGES.php;
  if (clean === 'dart') return AceConstants.LANGUAGES.dart;
  if (clean === 'scala') return AceConstants.LANGUAGES.scala;

  return { id: clean, name: raw.trim(), ext: '.txt' };
}

/**
 * Extract problem slug from a LeetCode problem URL path
 * @param {string} pathname
 * @returns {string|null}
 */
function extractAceProblemSlug(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  const match = pathname.match(/\/problems\/([^/]+)/);
  if (match && match[1] && match[1].toLowerCase() !== 'all') {
    return match[1].toLowerCase();
  }
  return null;
}

// Expose on globalThis so it is accessible in all extension execution contexts
if (typeof globalThis !== 'undefined') {
  globalThis.AceConstants = AceConstants;
  globalThis.normalizeAceLanguage = normalizeAceLanguage;
  globalThis.extractAceProblemSlug = extractAceProblemSlug;
}

// Support CommonJS for testing environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AceConstants,
    normalizeAceLanguage,
    extractAceProblemSlug
  };
}
