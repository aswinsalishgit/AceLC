/**
 * AceLC - Background Service Worker
 * Manages extension state, cross-component messaging, GitHub OAuth, and Repository Management.
 */

// Load shared constants into service worker scope
try {
  importScripts('../Shared/constants.js');
} catch (error) {
  console.error('[AceLC Background] Failed to load constants:', error);
}

// In-memory poll tracking
let activePollId = 0;
let isPollingActive = false;

/**
 * Handle extension installation or update
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[AceLC Background] Extension installed/updated. Reason:', details.reason);

  // Initialize default storage values if not already present
  chrome.storage.local.get(
    [
      AceConstants.STORAGE_KEYS.IS_ACTIVATED,
      AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS,
      AceConstants.STORAGE_KEYS.AUTH_STATE,
      AceConstants.STORAGE_KEYS.SELECTED_REPO
    ],
    (result) => {
      const updates = {};

      if (typeof result[AceConstants.STORAGE_KEYS.IS_ACTIVATED] === 'undefined') {
        updates[AceConstants.STORAGE_KEYS.IS_ACTIVATED] = false;
      }

      if (!Array.isArray(result[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS])) {
        updates[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS] = [];
      }

      if (!result[AceConstants.STORAGE_KEYS.AUTH_STATE]) {
        updates[AceConstants.STORAGE_KEYS.AUTH_STATE] = {
          status: AceConstants.AUTH_STATUS.NOT_CONNECTED
        };
      }

      if (typeof result[AceConstants.STORAGE_KEYS.SELECTED_REPO] === 'undefined') {
        updates[AceConstants.STORAGE_KEYS.SELECTED_REPO] = null;
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
 * Handle browser or worker startup: resume active polling if auth was pending
 */
chrome.runtime.onStartup.addListener(() => {
  resumePollingIfNeeded();
});

/**
 * Retrieve stored GitHub access token
 * @returns {Promise<string|null>}
 */
async function getStoredToken() {
  const result = await chrome.storage.local.get(AceConstants.STORAGE_KEYS.AUTH_TOKEN);
  return result[AceConstants.STORAGE_KEYS.AUTH_TOKEN] || null;
}

/**
 * Retrieve GitHub Client ID from storage or fall back to shared constants
 * @returns {Promise<string>}
 */
async function getEffectiveClientId(providedId) {
  if (providedId && typeof providedId === 'string' && providedId.trim().length > 0) {
    return providedId.trim();
  }

  const stored = await chrome.storage.local.get(AceConstants.STORAGE_KEYS.CLIENT_ID);
  if (stored[AceConstants.STORAGE_KEYS.CLIENT_ID]) {
    return stored[AceConstants.STORAGE_KEYS.CLIENT_ID].trim();
  }

  return (AceConstants.GITHUB.DEFAULT_CLIENT_ID || '').trim();
}

/**
 * Validate repository name according to GitHub naming conventions
 * @param {string} name 
 * @returns {string|null} Error string if invalid, null if valid
 */
function validateRepoName(name) {
  if (!name || typeof name !== 'string') {
    return 'Repository name is required.';
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Repository name cannot be empty.';
  }
  if (trimmed.length > 100) {
    return 'Repository name cannot exceed 100 characters.';
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return 'Repository name can only contain letters, numbers, hyphens, periods, and underscores.';
  }
  if (trimmed.startsWith('-') || trimmed.startsWith('.')) {
    return 'Repository name cannot start with a hyphen or period.';
  }
  if (trimmed.toLowerCase().endsWith('.git')) {
    return 'Repository name cannot end with .git.';
  }
  return null;
}

/**
 * Start GitHub OAuth Device Flow
 */
async function startDeviceFlow(providedClientId) {
  const clientId = await getEffectiveClientId(providedClientId);

  if (!clientId) {
    return {
      success: false,
      error: 'GitHub Client ID is required. Please enter an OAuth App Client ID with Device Flow enabled.'
    };
  }

  activePollId += 1;
  const currentPollId = activePollId;
  isPollingActive = true;

  try {
    const response = await fetch(AceConstants.GITHUB.DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: AceConstants.GITHUB.SCOPES
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const errorMsg = data.error_description || data.error || 'Failed to request device authorization';
      isPollingActive = false;
      await chrome.storage.local.set({
        [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
          status: AceConstants.AUTH_STATUS.FAILED,
          error: errorMsg
        }
      });
      return { success: false, error: errorMsg };
    }

    const expiresAt = Date.now() + ((data.expires_in || 900) * 1000);
    const interval = data.interval || 5;

    await chrome.storage.local.set({
      [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
        status: AceConstants.AUTH_STATUS.WAITING_FOR_AUTH,
        userCode: data.user_code,
        deviceCode: data.device_code,
        clientId: clientId,
        verificationUri: data.verification_uri || AceConstants.GITHUB.VERIFICATION_URL,
        expiresAt: expiresAt,
        interval: interval
      }
    });

    pollDeviceToken(clientId, data.device_code, interval, expiresAt, currentPollId);

    return {
      success: true,
      userCode: data.user_code,
      verificationUri: data.verification_uri || AceConstants.GITHUB.VERIFICATION_URL,
      expiresAt: expiresAt,
      interval: interval
    };
  } catch (err) {
    isPollingActive = false;
    const errorMsg = err.message || 'Network error requesting device authorization';
    await chrome.storage.local.set({
      [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
        status: AceConstants.AUTH_STATUS.FAILED,
        error: errorMsg
      }
    });
    return { success: false, error: errorMsg };
  }
}

/**
 * Poll GitHub for access token
 */
function pollDeviceToken(clientId, deviceCode, intervalSeconds, expiresAt, pollId) {
  if (pollId !== activePollId) {
    isPollingActive = false;
    return;
  }

  if (Date.now() >= expiresAt) {
    isPollingActive = false;
    chrome.storage.local.set({
      [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
        status: AceConstants.AUTH_STATUS.FAILED,
        error: 'Verification code has expired. Please try connecting again.'
      }
    });
    return;
  }

  isPollingActive = true;

  setTimeout(async () => {
    if (pollId !== activePollId) {
      isPollingActive = false;
      return;
    }

    try {
      const response = await fetch(AceConstants.GITHUB.TOKEN_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });

      const data = await response.json();

      if (pollId !== activePollId) {
        isPollingActive = false;
        return;
      }

      if (data.error) {
        if (data.error === 'authorization_pending') {
          pollDeviceToken(clientId, deviceCode, intervalSeconds, expiresAt, pollId);
        } else if (data.error === 'slow_down') {
          const newInterval = (data.interval || intervalSeconds) + 5;
          pollDeviceToken(clientId, deviceCode, newInterval, expiresAt, pollId);
        } else if (data.error === 'expired_token') {
          isPollingActive = false;
          chrome.storage.local.set({
            [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
              status: AceConstants.AUTH_STATUS.FAILED,
              error: 'Verification code has expired. Please try connecting again.'
            }
          });
        } else if (data.error === 'access_denied') {
          isPollingActive = false;
          chrome.storage.local.set({
            [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
              status: AceConstants.AUTH_STATUS.FAILED,
              error: 'Authorization was cancelled or denied on GitHub.'
            }
          });
        } else {
          isPollingActive = false;
          chrome.storage.local.set({
            [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
              status: AceConstants.AUTH_STATUS.FAILED,
              error: data.error_description || data.error
            }
          });
        }
        return;
      }

      if (data.access_token) {
        isPollingActive = false;
        console.log('[AceLC Background] GitHub access token received successfully.');
        await fetchAndSaveUserProfile(data.access_token);
      }
    } catch (err) {
      if (pollId !== activePollId) {
        isPollingActive = false;
        return;
      }
      console.warn('[AceLC Background] Polling network issue, continuing next cycle...');
      pollDeviceToken(clientId, deviceCode, intervalSeconds, expiresAt, pollId);
    }
  }, Math.max(intervalSeconds, 5) * 1000);
}

/**
 * Instantly check authorization status right now on user demand
 */
async function checkAuthNow() {
  const result = await chrome.storage.local.get([
    AceConstants.STORAGE_KEYS.AUTH_STATE
  ]);

  const authState = result[AceConstants.STORAGE_KEYS.AUTH_STATE];
  if (!authState || authState.status !== AceConstants.AUTH_STATUS.WAITING_FOR_AUTH || !authState.deviceCode) {
    return { success: false, error: 'No active device authorization in progress.' };
  }

  const clientId = authState.clientId || await getEffectiveClientId();
  const deviceCode = authState.deviceCode;

  try {
    const response = await fetch(AceConstants.GITHUB.TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });

    const data = await response.json();

    if (data.error) {
      if (data.error === 'authorization_pending') {
        resumePollingIfNeeded();
        return {
          success: false,
          pending: true,
          message: 'GitHub has not completed approval yet. Please make sure you clicked "Authorize" on GitHub.'
        };
      }
      if (data.error === 'slow_down') {
        resumePollingIfNeeded();
        return {
          success: false,
          pending: true,
          message: 'GitHub requested to slow down polling. Please wait a few seconds and try again.'
        };
      }
      const errorMsg = data.error_description || data.error;
      await chrome.storage.local.set({
        [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
          status: AceConstants.AUTH_STATUS.FAILED,
          error: errorMsg
        }
      });
      return { success: false, error: errorMsg };
    }

    if (data.access_token) {
      isPollingActive = false;
      activePollId += 1;
      const profileResult = await fetchAndSaveUserProfile(data.access_token);
      return {
        success: true,
        user: profileResult.user
      };
    }

    return { success: false, error: 'Unexpected response from GitHub.' };
  } catch (err) {
    return { success: false, error: err.message || 'Network error verifying approval.' };
  }
}

/**
 * Resume background polling if auth is currently pending and not running
 */
async function resumePollingIfNeeded() {
  if (isPollingActive) {
    return;
  }

  const result = await chrome.storage.local.get([
    AceConstants.STORAGE_KEYS.AUTH_STATE,
    AceConstants.STORAGE_KEYS.AUTH_TOKEN
  ]);

  if (result[AceConstants.STORAGE_KEYS.AUTH_TOKEN]) {
    return;
  }

  const authState = result[AceConstants.STORAGE_KEYS.AUTH_STATE];
  if (
    authState &&
    authState.status === AceConstants.AUTH_STATUS.WAITING_FOR_AUTH &&
    authState.deviceCode &&
    authState.expiresAt &&
    Date.now() < authState.expiresAt
  ) {
    activePollId += 1;
    isPollingActive = true;
    const clientId = authState.clientId || await getEffectiveClientId();
    const interval = authState.interval || 5;
    console.log('[AceLC Background] Resuming active polling for code:', authState.userCode);
    pollDeviceToken(clientId, authState.deviceCode, interval, authState.expiresAt, activePollId);
  }
}

/**
 * Fetch basic profile of the authenticated user
 */
async function fetchAndSaveUserProfile(accessToken) {
  try {
    const response = await fetch(AceConstants.GITHUB.USER_API_URL, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      throw new Error(`Profile fetch failed: ${response.status}`);
    }

    const user = await response.json();
    const userProfile = {
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatar_url || '',
      htmlUrl: user.html_url || `https://github.com/${user.login}`
    };

    await chrome.storage.local.set({
      [AceConstants.STORAGE_KEYS.AUTH_TOKEN]: accessToken,
      [AceConstants.STORAGE_KEYS.USER_INFO]: userProfile,
      [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
        status: AceConstants.AUTH_STATUS.CONNECTED
      }
    });

    console.log(`[AceLC Background] Successfully authenticated as @${userProfile.login}`);
    return { success: true, user: userProfile };
  } catch (err) {
    console.error('[AceLC Background] Failed to fetch user profile:', err);
    await chrome.storage.local.set({
      [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
        status: AceConstants.AUTH_STATUS.FAILED,
        error: 'Failed to retrieve GitHub profile after authorization.'
      }
    });
    return { success: false, error: err.message };
  }
}

/**
 * Cancel any ongoing device flow
 */
async function cancelDeviceFlow() {
  activePollId += 1;
  isPollingActive = false;
  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
      status: AceConstants.AUTH_STATUS.NOT_CONNECTED
    }
  });
  return { success: true };
}

/**
 * Disconnect GitHub account and purge stored credentials and selected repository
 */
async function disconnectGitHub() {
  activePollId += 1;
  isPollingActive = false;
  await chrome.storage.local.remove([
    AceConstants.STORAGE_KEYS.AUTH_TOKEN,
    AceConstants.STORAGE_KEYS.USER_INFO,
    AceConstants.STORAGE_KEYS.SELECTED_REPO
  ]);
  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
      status: AceConstants.AUTH_STATUS.NOT_CONNECTED
    }
  });
  console.log('[AceLC Background] GitHub account disconnected. Storage cleared.');
  return { success: true };
}

/**
 * Get current authentication status and user details
 */
async function getAuthStatus() {
  const result = await chrome.storage.local.get([
    AceConstants.STORAGE_KEYS.AUTH_TOKEN,
    AceConstants.STORAGE_KEYS.USER_INFO,
    AceConstants.STORAGE_KEYS.AUTH_STATE,
    AceConstants.STORAGE_KEYS.CLIENT_ID
  ]);

  const hasToken = !!result[AceConstants.STORAGE_KEYS.AUTH_TOKEN];
  const user = result[AceConstants.STORAGE_KEYS.USER_INFO] || null;
  const authState = result[AceConstants.STORAGE_KEYS.AUTH_STATE] || {
    status: AceConstants.AUTH_STATUS.NOT_CONNECTED
  };
  const clientId = result[AceConstants.STORAGE_KEYS.CLIENT_ID] || AceConstants.GITHUB.DEFAULT_CLIENT_ID || '';

  let status = authState.status || AceConstants.AUTH_STATUS.NOT_CONNECTED;
  if (hasToken && user) {
    status = AceConstants.AUTH_STATUS.CONNECTED;
  }

  if (status === AceConstants.AUTH_STATUS.WAITING_FOR_AUTH) {
    resumePollingIfNeeded();
  }

  return {
    success: true,
    status: status,
    user: user,
    authState: authState,
    clientId: clientId
  };
}

/**
 * =========================================================================
 * REPOSITORY MANAGEMENT (PHASE 3)
 * =========================================================================
 */

/**
 * Retrieve all repositories owned by the authenticated user with pagination support
 * @returns {Promise<{success: boolean, repositories?: Array, error?: string}>}
 */
async function fetchUserRepositories() {
  const token = await getStoredToken();
  if (!token) {
    return { success: false, error: 'Not authenticated with GitHub.' };
  }

  const allRepos = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;
  const maxPages = 10; // safety limit to fetch up to 1,000 repos

  try {
    while (hasMore && page <= maxPages) {
      const url = `${AceConstants.GITHUB.USER_REPOS_URL}?affiliation=owner&sort=updated&direction=desc&per_page=${perPage}&page=${page}`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, error: 'GitHub session expired. Please reconnect your account.' };
        }
        return { success: false, error: `GitHub API error (${response.status}): Failed to fetch repositories.` };
      }

      const repos = await response.json();
      if (!Array.isArray(repos) || repos.length === 0) {
        hasMore = false;
      } else {
        for (const repo of repos) {
          allRepos.push({
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            owner: repo.owner ? repo.owner.login : '',
            isPrivate: Boolean(repo.private),
            htmlUrl: repo.html_url,
            defaultBranch: repo.default_branch || 'main',
            description: repo.description || ''
          });
        }

        if (repos.length < perPage) {
          hasMore = false;
        } else {
          page += 1;
        }
      }
    }

    return { success: true, repositories: allRepos };
  } catch (err) {
    return { success: false, error: err.message || 'Network error while fetching repositories.' };
  }
}

/**
 * Create a new repository for the authenticated user
 * @param {{name: string, description?: string, isPrivate: boolean}} params
 * @returns {Promise<{success: boolean, repository?: Object, error?: string}>}
 */
async function createRepository({ name, description, isPrivate }) {
  const token = await getStoredToken();
  if (!token) {
    return { success: false, error: 'Not authenticated with GitHub.' };
  }

  // Validate repository name
  const validationError = validateRepoName(name);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const payload = {
    name: name.trim(),
    description: (description || '').trim(),
    private: Boolean(isPrivate),
    auto_init: true // Initializes repository with README so default branch exists
  };

  try {
    const response = await fetch(AceConstants.GITHUB.USER_REPOS_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 422) {
        let details = 'Validation error';
        if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
          details = data.errors.map((e) => e.message || e.code).join(', ');
        } else if (data.message) {
          details = data.message;
        }
        return { success: false, error: `Repository creation failed: ${details}` };
      }
      return { success: false, error: data.message || `Failed to create repository (${response.status})` };
    }

    const createdRepo = {
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      owner: data.owner ? data.owner.login : '',
      isPrivate: Boolean(data.private),
      htmlUrl: data.html_url,
      defaultBranch: data.default_branch || 'main',
      description: data.description || ''
    };

    // Automatically select the newly created repository
    await chrome.storage.local.set({
      [AceConstants.STORAGE_KEYS.SELECTED_REPO]: createdRepo
    });

    console.log(`[AceLC Background] Created and selected repository: ${createdRepo.fullName}`);
    return { success: true, repository: createdRepo };
  } catch (err) {
    return { success: false, error: err.message || 'Network error while creating repository.' };
  }
}

/**
 * Save selected repository configuration
 * @param {Object} repo 
 */
async function selectRepository(repo) {
  if (!repo || !repo.fullName || !repo.name) {
    return { success: false, error: 'Invalid repository data.' };
  }

  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.SELECTED_REPO]: repo
  });

  console.log(`[AceLC Background] Selected repository saved: ${repo.fullName}`);
  return { success: true, repository: repo };
}

/**
 * Retrieve currently selected repository
 */
async function getSelectedRepository() {
  const result = await chrome.storage.local.get(AceConstants.STORAGE_KEYS.SELECTED_REPO);
  return {
    success: true,
    repository: result[AceConstants.STORAGE_KEYS.SELECTED_REPO] || null
  };
}

/**
 * Handle runtime messages from popup and other components
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== 'string') {
    sendResponse({ success: false, error: 'Invalid message structure' });
    return false;
  }

  // Authentication actions
  if (message.action === AceConstants.MESSAGES.START_AUTH) {
    startDeviceFlow(message.clientId).then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.CHECK_AUTH_NOW) {
    checkAuthNow().then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.CANCEL_AUTH) {
    cancelDeviceFlow().then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.DISCONNECT_AUTH) {
    disconnectGitHub().then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.GET_AUTH_STATUS) {
    getAuthStatus().then(sendResponse);
    return true;
  }

  // Repository actions (Phase 3)
  if (message.action === AceConstants.MESSAGES.GET_REPOSITORIES) {
    fetchUserRepositories().then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.CREATE_REPOSITORY) {
    createRepository(message.payload || {}).then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.SELECT_REPOSITORY) {
    selectRepository(message.repository).then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.GET_SELECTED_REPO) {
    getSelectedRepository().then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.GET_STATUS) {
    sendResponse({
      success: true,
      name: AceConstants.EXTENSION_NAME,
      version: AceConstants.VERSION,
      phase: 'Phase 3: GitHub Repository Management'
    });
    return false;
  }

  sendResponse({ success: false, error: 'Unhandled action' });
  return false;
});
