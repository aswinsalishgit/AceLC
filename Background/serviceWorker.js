/**
 * AceLC - Background Service Worker
 * Manages extension state, cross-component messaging, GitHub OAuth,
 * Repository Management, and Destination Folder Management.
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

      if (!Array.isArray(result[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE])) {
        updates[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE] = [];
      }

      if (!Array.isArray(result[AceConstants.STORAGE_KEYS.CONFIRMED_SUBMISSIONS])) {
        updates[AceConstants.STORAGE_KEYS.CONFIRMED_SUBMISSIONS] = [];
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
 * Normalize a folder path by trimming, cleaning slashes, and removing duplicate separators
 * @param {string} path 
 * @returns {string} Normalized path (e.g. "Easy" or "Algorithms/TwoSum")
 */
function normalizeFolderPath(path) {
  if (!path || typeof path !== 'string') return '';
  return path
    .trim()
    .replace(/\\+/g, '/') // replace backslashes with forward slashes
    .replace(/^\/+|\/+$/g, '') // remove leading & trailing slashes
    .replace(/\/+/g, '/'); // collapse consecutive slashes
}

/**
 * Validate a destination folder path
 * @param {string} path 
 * @returns {string|null} Error message if invalid, null if valid
 */
function validateFolderPath(path) {
  const normalized = normalizeFolderPath(path);
  if (!normalized) {
    return 'Folder path cannot be empty.';
  }
  if (normalized.length > 200) {
    return 'Folder path is too long (maximum 200 characters).';
  }

  const segments = normalized.split('/');
  for (const seg of segments) {
    const trimmedSeg = seg.trim();
    if (!trimmedSeg) {
      return 'Folder path contains an empty segment.';
    }
    if (trimmedSeg === '.' || trimmedSeg === '..') {
      return 'Folder path cannot contain "." or ".." segments.';
    }
    if (trimmedSeg.toLowerCase() === '.git') {
      return 'Folder path cannot contain ".git".';
    }
    if (!/^[a-zA-Z0-9_\-. ]+$/.test(trimmedSeg)) {
      return 'Folder names can only contain letters, numbers, hyphens, underscores, dots, and spaces.';
    }
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
 * Disconnect GitHub account and purge stored credentials, repo, and folders
 */
async function disconnectGitHub() {
  activePollId += 1;
  isPollingActive = false;
  await chrome.storage.local.remove([
    AceConstants.STORAGE_KEYS.AUTH_TOKEN,
    AceConstants.STORAGE_KEYS.USER_INFO,
    AceConstants.STORAGE_KEYS.SELECTED_REPO,
    AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS
  ]);
  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.AUTH_STATE]: {
      status: AceConstants.AUTH_STATUS.NOT_CONNECTED
    },
    [AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]: []
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
  const maxPages = 10;

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
 */
async function createRepository({ name, description, isPrivate }) {
  const token = await getStoredToken();
  if (!token) {
    return { success: false, error: 'Not authenticated with GitHub.' };
  }

  const validationError = validateRepoName(name);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const payload = {
    name: name.trim(),
    description: (description || '').trim(),
    private: Boolean(isPrivate),
    auto_init: true
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
      if (response.status === 401) {
        return { success: false, error: 'GitHub session expired. Please reconnect your account.' };
      }
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

    // Selecting new repo resets destination folders to prevent invalid folders
    await chrome.storage.local.set({
      [AceConstants.STORAGE_KEYS.SELECTED_REPO]: createdRepo,
      [AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]: []
    });

    console.log(`[AceLC Background] Created and selected repository: ${createdRepo.fullName}`);
    return { success: true, repository: createdRepo };
  } catch (err) {
    return { success: false, error: err.message || 'Network error while creating repository.' };
  }
}

/**
 * Save selected repository configuration.
 * Resets configured destination folders if switching to a different repository.
 */
async function selectRepository(repo) {
  if (!repo || !repo.fullName || !repo.name) {
    return { success: false, error: 'Invalid repository data.' };
  }

  const current = await chrome.storage.local.get([
    AceConstants.STORAGE_KEYS.SELECTED_REPO,
    AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS
  ]);

  const currentRepo = current[AceConstants.STORAGE_KEYS.SELECTED_REPO];
  const updates = {
    [AceConstants.STORAGE_KEYS.SELECTED_REPO]: repo
  };

  // Reset destination folders if repository changed
  if (!currentRepo || currentRepo.fullName !== repo.fullName) {
    updates[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS] = [];
    console.log(`[AceLC Background] Switched repository to ${repo.fullName}. Destination folders reset.`);
  }

  await chrome.storage.local.set(updates);
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
 * =========================================================================
 * FOLDER MANAGEMENT (PHASE 4)
 * =========================================================================
 */

/**
 * Retrieve existing directories in the selected repository using GitHub Git Trees API
 * @returns {Promise<{success: boolean, directories?: Array<string>, isEmpty?: boolean, error?: string}>}
 */
async function fetchRepoDirectories() {
  const token = await getStoredToken();
  if (!token) {
    return { success: false, error: 'Not authenticated with GitHub.' };
  }

  const result = await chrome.storage.local.get(AceConstants.STORAGE_KEYS.SELECTED_REPO);
  const selectedRepo = result[AceConstants.STORAGE_KEYS.SELECTED_REPO];
  if (!selectedRepo || !selectedRepo.owner || !selectedRepo.name) {
    return { success: false, error: 'No repository selected.' };
  }

  const owner = selectedRepo.owner;
  const repo = selectedRepo.name;
  const defaultBranch = selectedRepo.defaultBranch || 'main';

  try {
    // Attempt recursive git tree fetch using default branch
    const url = `${AceConstants.GITHUB.REPOS_API_URL}/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (response.status === 401) {
      return { success: false, error: 'GitHub session expired. Please reconnect your account.' };
    }

    // 409 Conflict: Git Repository is empty
    // 404 Not Found: Branch does not exist or empty repo without commits
    if (response.status === 409 || response.status === 404) {
      return { success: true, directories: [], isEmpty: true };
    }

    if (!response.ok) {
      return { success: false, error: `Failed to fetch repository tree (${response.status})` };
    }

    const data = await response.json();
    const directories = [];

    if (Array.isArray(data.tree)) {
      for (const item of data.tree) {
        if (item.type === 'tree' && item.path) {
          directories.push(item.path);
        }
      }
    }

    directories.sort((a, b) => a.localeCompare(b));
    return { success: true, directories: directories, isEmpty: false };
  } catch (err) {
    return { success: false, error: err.message || 'Network error fetching repository directories.' };
  }
}

/**
 * Retrieve all currently configured destination folders
 */
async function getDestinationFolders() {
  const result = await chrome.storage.local.get(AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS);
  const folders = Array.isArray(result[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS])
    ? result[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]
    : [];

  return { success: true, folders };
}

/**
 * Add a new destination folder path to the configured destinations
 * @param {string} rawPath 
 */
async function addDestinationFolder(rawPath) {
  const validationError = validateFolderPath(rawPath);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const normalizedPath = normalizeFolderPath(rawPath);
  const result = await chrome.storage.local.get(AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS);
  const currentFolders = Array.isArray(result[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS])
    ? result[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]
    : [];

  // Avoid duplicates
  if (currentFolders.includes(normalizedPath)) {
    return { success: false, error: `Folder "${normalizedPath}" is already configured.` };
  }

  const updatedFolders = [...currentFolders, normalizedPath];
  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]: updatedFolders
  });

  console.log(`[AceLC Background] Added destination folder: ${normalizedPath}`);
  return { success: true, folders: updatedFolders };
}

/**
 * Remove a destination folder path from the configured destinations
 * @param {string} rawPath 
 */
async function removeDestinationFolder(rawPath) {
  const normalizedPath = normalizeFolderPath(rawPath);
  const result = await chrome.storage.local.get(AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS);
  const currentFolders = Array.isArray(result[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS])
    ? result[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]
    : [];

  const updatedFolders = currentFolders.filter((f) => f !== normalizedPath);
  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]: updatedFolders
  });

  console.log(`[AceLC Background] Removed destination folder: ${normalizedPath}`);
  return { success: true, folders: updatedFolders };
}

/**
 * Overwrite all destination folders with a new list
 * @param {Array<string>} foldersArray 
 */
async function setDestinationFolders(foldersArray) {
  if (!Array.isArray(foldersArray)) {
    return { success: false, error: 'Invalid folders list.' };
  }

  const cleaned = [];
  for (const item of foldersArray) {
    const err = validateFolderPath(item);
    if (!err) {
      const norm = normalizeFolderPath(item);
      if (!cleaned.includes(norm)) {
        cleaned.push(norm);
      }
    }
  }

  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]: cleaned
  });

  return { success: true, folders: cleaned };
}

/**
 * =========================================================================
 * GITHUB SOLUTION UPLOADING, FOLDER STRUCTURE & DASHBOARD
 * =========================================================================
 */

/**
 * Format problem title to Title-Case-With-Hyphens.
 * e.g. "Two Sum" -> "Two-Sum", "add-two-numbers" -> "Add-Two-Numbers"
 * @param {string} title 
 * @param {string} slug 
 * @returns {string}
 */
function formatTitleCaseSlug(title, slug) {
  let source = title || slug || 'Solution';
  // Strip leading problem number prefix if present in title (e.g. "1. Two Sum" -> "Two Sum")
  source = String(source).replace(/^\d+[\s.-]+/, '');
  if (!source && slug) {
    source = slug;
  }
  // Split on spaces, underscores, or hyphens
  const words = source
    .replace(/[^a-zA-Z0-9\s-_]/g, '')
    .trim()
    .split(/[\s-_]+/)
    .filter(Boolean);

  if (words.length === 0) return 'Solution';

  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('-');
}

/**
 * Generate standardized problem folder name.
 * Format: <FOUR-DIGIT-PROBLEM-NUMBER>-<Problem-Name-With-Title-Case>
 * Example: 0001-Two-Sum
 * @param {object} submission
 * @returns {string}
 */
function generateProblemFolderName(submission) {
  const { problemNumber, problemTitle, problemSlug } = submission;
  let numInt = parseInt(problemNumber, 10);

  // If problemNumber wasn't parsed, try extracting from title (e.g. "1. Two Sum" or "9. Palindrome Number")
  if (isNaN(numInt) && problemTitle) {
    const match = String(problemTitle).match(/^(\d+)\./);
    if (match) {
      numInt = parseInt(match[1], 10);
    }
  }

  // Fallbacks if problem number could not be determined
  if (isNaN(numInt) || numInt <= 0) {
    if ((problemSlug || '').toLowerCase() === 'two-sum') {
      numInt = 1;
    } else if ((problemSlug || '').toLowerCase() === 'palindrome-number') {
      numInt = 9;
    } else {
      numInt = 1;
    }
  }

  const paddedNumber = String(numInt).padStart(4, '0');

  // Verify title corresponds to slug; if mismatched, prefer the slug
  let cleanTitle = problemTitle ? String(problemTitle).replace(/^\d+[\s.-]+/, '').trim() : '';
  const slugWords = (problemSlug || '').toLowerCase().split('-');
  const titleWords = cleanTitle.toLowerCase().split(/\s+/);
  const hasOverlap = slugWords.some((w) => titleWords.includes(w));
  if (!cleanTitle || (!hasOverlap && problemSlug)) {
    cleanTitle = problemSlug;
  }

  const titlePart = formatTitleCaseSlug(cleanTitle, problemSlug);
  return `${paddedNumber}-${titlePart}`;
}

/**
 * Format standardized complexity-based Git commit message.
 * Format: Time: <time> ms (<time-percentile>%), Space: <memory> MB (<memory-percentile>%) - AceLC
 * Uses actual metrics and percentages. Never defaults missing metrics to fabricated 0 values.
 * @param {object} submission
 * @returns {string}
 */
function generateComplexityCommitMessage(submission) {
  let timeStr = 'N/A';
  let timePct = 'N/A';
  let spaceStr = 'N/A';
  let spacePct = 'N/A';

  // 1. Runtime
  if (submission.runtime !== null && submission.runtime !== undefined && String(submission.runtime).trim().length > 0) {
    const rawRuntime = String(submission.runtime).trim();
    const rMatch = rawRuntime.match(/(\d+(?:\.\d+)?)\s*(?:ms)?/i);
    if (rMatch) {
      timeStr = `${rMatch[1]} ms`;
    } else {
      timeStr = rawRuntime;
    }
  }

  // 2. Runtime Percentile (Beats %)
  if (submission.runtimePercentile !== null && submission.runtimePercentile !== undefined && String(submission.runtimePercentile).trim().length > 0) {
    const rawVal = String(submission.runtimePercentile).replace('%', '').trim();
    const num = parseFloat(rawVal);
    if (!isNaN(num)) {
      timePct = `${num.toFixed(2)}%`;
    }
  }

  // 3. Memory
  if (submission.memory !== null && submission.memory !== undefined && String(submission.memory).trim().length > 0) {
    const rawMem = String(submission.memory).trim();
    const mMatch = rawMem.match(/(\d+(?:\.\d+)?)\s*(?:mb|kb|gb)?/i);
    if (mMatch) {
      spaceStr = `${mMatch[1]} MB`;
    } else {
      spaceStr = rawMem;
    }
  }

  // 4. Memory Percentile (Beats %)
  if (submission.memoryPercentile !== null && submission.memoryPercentile !== undefined && String(submission.memoryPercentile).trim().length > 0) {
    const rawVal = String(submission.memoryPercentile).replace('%', '').trim();
    const num = parseFloat(rawVal);
    if (!isNaN(num)) {
      spacePct = `${num.toFixed(2)}%`;
    }
  }

  return `Time: ${timeStr} (${timePct}), Space: ${spaceStr} (${spacePct}) - AceLC`;
}

/**
 * Generate complete PROBLEM.md markdown content.
 * @param {object} submission
 * @returns {string}
 */
function generateProblemMarkdown(submission) {
  const numDisplay = submission.problemNumber ? `${submission.problemNumber}. ` : '';
  const title = submission.problemTitle || submission.problemSlug || 'Problem';
  const diff = submission.difficulty || 'Medium';
  const url = submission.problemUrl || `https://leetcode.com/problems/${submission.problemSlug}/`;

  let md = `# [${numDisplay}${title}](${url})\n\n`;
  md += `**Difficulty:** \`${diff}\`\n\n`;

  if (submission.statement && submission.statement.trim().length > 0) {
    md += `## Problem Statement\n\n${submission.statement.trim()}\n\n`;
  }

  md += `---\n\n`;
  md += `*Problem source: [LeetCode](${url}) | Uploaded via [AceLC](https://github.com/aswinsalishgit/CodeGab-AceLC)*\n`;
  return md;
}

/**
 * Decode Base64 string safely back to Unicode UTF-8 string
 * @param {string} b64
 * @returns {string}
 */
function decodeBase64Unicode(b64) {
  if (!b64) return '';
  const cleanB64 = b64.replace(/\s+/g, '');
  const binary = atob(cleanB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Fetch existing file content from GitHub repository.
 * Returns { exists: boolean, content: string|null, sha: string|null, error: string|null }
 * @param {string} token
 * @param {string} fullName
 * @param {string} filePath
 * @param {string} branch
 */
async function fetchFileContent(token, fullName, filePath, branch) {
  const url = `${buildContentsUrl(fullName, filePath)}?ref=${encodeURIComponent(branch)}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (response.status === 404) {
      return { exists: false, content: null, sha: null, error: null };
    }

    if (response.status === 401) {
      return { exists: false, content: null, sha: null, error: 'GitHub session expired. Please reconnect your account.' };
    }

    if (!response.ok) {
      return { exists: false, content: null, sha: null, error: `GitHub API error (${response.status})` };
    }

    const data = await response.json();
    let text = '';
    if (data.content) {
      text = decodeBase64Unicode(data.content);
    }
    return { exists: true, content: text, sha: data.sha || null, error: null };
  } catch (err) {
    return { exists: false, content: null, sha: null, error: err.message };
  }
}

/**
 * Build or update the GitHub repository README.md dashboard.
 * Positions Problem Solving Dashboard and Problem Index at the very beginning of README.md.
 * Center-aligns both headings and keeps design clean, minimalistic, and professional.
 * Preserves all unrelated README content.
 * @param {string} existingReadme
 * @param {Array<object>} allUploadedHistory
 * @returns {string}
 */
function sanitizeTableField(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildOrUpdateRepositoryReadme(existingReadme, allUploadedHistory) {
  // Sort history by problem number ascending (or slug if number not present)
  const sorted = [...allUploadedHistory].sort((a, b) => {
    const numA = parseInt(a.problemNumber, 10);
    const numB = parseInt(b.problemNumber, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    if (!isNaN(numA)) return -1;
    if (!isNaN(numB)) return 1;
    return (a.problemSlug || '').localeCompare(b.problemSlug || '');
  });

  const total = sorted.length;
  const easy = sorted.filter((p) => (p.difficulty || '').toLowerCase() === 'easy').length;
  const medium = sorted.filter((p) => (p.difficulty || '').toLowerCase() === 'medium').length;
  const hard = sorted.filter((p) => (p.difficulty || '').toLowerCase() === 'hard').length;

  let tableRows = '';
  if (sorted.length === 0) {
    tableRows = '| — | *No problems tracked yet* | — | — | — | — | — |\n';
  } else {
    for (const p of sorted) {
      let numInt = parseInt(p.problemNumber, 10);
      if (isNaN(numInt) && p.problemSlug === 'palindrome-number') numInt = 9;
      if (isNaN(numInt) && p.problemSlug === 'two-sum') numInt = 1;
      const num = !isNaN(numInt) ? String(numInt).padStart(4, '0') : '----';

      // Self-heal title if corrupted by previous cross-problem bug
      let title = p.problemTitle || '';
      if (!title || (p.problemSlug === 'palindrome-number' && title.toLowerCase().includes('two'))) {
        title = 'Palindrome Number';
      }
      title = sanitizeTableField(title || p.problemSlug);

      const url = p.problemUrl || `https://leetcode.com/problems/${p.problemSlug}/`;
      const diff = sanitizeTableField(p.difficulty || 'Easy');

      const folder = p.folderPath || '';
      const solPath = folder ? `${folder}/SOLUTION.java` : 'SOLUTION.java';
      const probPath = folder ? `${folder}/PROBLEM.md` : 'PROBLEM.md';

      let timeStr = 'N/A';
      if (p.runtime) {
        let cleanRuntime = sanitizeTableField(p.runtime);
        const rMatch = cleanRuntime.match(/(\d+(?:\.\d+)?)\s*(?:ms)?/i);
        if (rMatch) cleanRuntime = `${rMatch[1]} ms`;

        if (p.runtimePercentile !== null && p.runtimePercentile !== undefined && String(p.runtimePercentile).trim().length > 0) {
          const numPct = parseFloat(String(p.runtimePercentile).replace('%', '').trim());
          timeStr = !isNaN(numPct) ? `${cleanRuntime} (${numPct.toFixed(2)}%)` : cleanRuntime;
        } else {
          timeStr = cleanRuntime;
        }
      }

      let spaceStr = 'N/A';
      if (p.memory) {
        let cleanMemory = sanitizeTableField(p.memory);
        const mMatch = cleanMemory.match(/(\d+(?:\.\d+)?)\s*(?:mb|kb|gb)?/i);
        if (mMatch) cleanMemory = `${mMatch[1]} MB`;

        if (p.memoryPercentile !== null && p.memoryPercentile !== undefined && String(p.memoryPercentile).trim().length > 0) {
          const numPct = parseFloat(String(p.memoryPercentile).replace('%', '').trim());
          spaceStr = !isNaN(numPct) ? `${cleanMemory} (${numPct.toFixed(2)}%)` : cleanMemory;
        } else {
          spaceStr = cleanMemory;
        }
      }

      tableRows += `| ${num} | [${title}](${url}) | ${diff} | [Solution](${encodeURI(solPath)}) | [Problem](${encodeURI(probPath)}) | ${timeStr} | ${spaceStr} |\n`;
    }
  }

  const startMarker = '<!-- ACELC_DASHBOARD_START -->';
  const endMarker = '<!-- ACELC_DASHBOARD_END -->';

  const dashboardContent = `${startMarker}
<div align="center">

<h2>Problem Solving Dashboard</h2>

| Total Solved | Easy | Medium | Hard |
| :---: | :---: | :---: | :---: |
| **${total}** | **${easy}** | **${medium}** | **${hard}** |

<h3>Problem Index</h3>

| # | Title | Difficulty | Solution | Statement | Runtime | Memory |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${tableRows.trim()}

</div>
${endMarker}`;

  // Extract any existing unrelated content by removing previous dashboard block
  let remainingContent = '';
  if (existingReadme && existingReadme.trim().length > 0) {
    if (existingReadme.includes(startMarker) && existingReadme.includes(endMarker)) {
      const sIdx = existingReadme.indexOf(startMarker);
      const eIdx = existingReadme.indexOf(endMarker) + endMarker.length;
      remainingContent = (existingReadme.slice(0, sIdx) + existingReadme.slice(eIdx)).trim();
    } else {
      remainingContent = existingReadme.trim();
    }
  }

  // Always position the dashboard at the VERY BEGINNING of the README
  if (remainingContent.length > 0) {
    return `${dashboardContent}\n\n---\n\n${remainingContent}\n`;
  }
  return `${dashboardContent}\n`;
}

/**
 * Update local extension stats and upload history in chrome.storage.local
 * @param {object} record
 */
async function recordSuccessfulUploadInStats(record) {
  const stored = await chrome.storage.local.get([
    AceConstants.STORAGE_KEYS.STATS,
    AceConstants.STORAGE_KEYS.UPLOAD_HISTORY
  ]);

  let history = Array.isArray(stored[AceConstants.STORAGE_KEYS.UPLOAD_HISTORY])
    ? stored[AceConstants.STORAGE_KEYS.UPLOAD_HISTORY]
    : [];

  // Self-heal any corrupted history entries
  for (const h of history) {
    if (h.problemSlug === 'palindrome-number' && (!h.problemTitle || h.problemTitle.toLowerCase().includes('two'))) {
      h.problemTitle = 'Palindrome Number';
      h.problemNumber = '9';
      h.difficulty = 'Easy';
    }
  }

  const slug = record.problemSlug;
  const existingIdx = history.findIndex((h) => h.problemSlug === slug);

  let title = record.problemTitle;
  if (!title || (slug === 'palindrome-number' && title.toLowerCase().includes('two'))) {
    title = 'Palindrome Number';
  }

  const entry = {
    problemNumber: record.problemNumber,
    problemTitle: title,
    problemSlug: record.problemSlug,
    problemUrl: record.problemUrl,
    difficulty: record.difficulty || 'Medium',
    folderPath: record.primaryFolderRelative || record.confirmedFolders[0] || '',
    runtime: record.runtime || null,
    memory: record.memory || null,
    runtimePercentile: record.runtimePercentile || null,
    memoryPercentile: record.memoryPercentile || null,
    uploadedAt: Date.now()
  };

  if (existingIdx !== -1) {
    history[existingIdx] = entry; // Update existing entry without double counting
  } else {
    history.push(entry);
  }

  // Calculate stats from unique history
  const total = history.length;
  const easy = history.filter((p) => (p.difficulty || '').toLowerCase() === 'easy').length;
  const medium = history.filter((p) => (p.difficulty || '').toLowerCase() === 'medium').length;
  const hard = history.filter((p) => (p.difficulty || '').toLowerCase() === 'hard').length;

  const stats = {
    total,
    easy,
    medium,
    hard,
    lastUpdated: Date.now()
  };

  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.STATS]: stats,
    [AceConstants.STORAGE_KEYS.UPLOAD_HISTORY]: history
  });

  console.log(`[AceLC Background] Stats updated: Total=${total}, Easy=${easy}, Medium=${medium}, Hard=${hard}`);
  return { stats, history };
}

/**
 * Encode a string to Base64, preserving full Unicode characters.
 * Uses TextEncoder + Uint8Array to handle multi-byte code points
 * (e.g. CJK characters, emoji) that btoa alone cannot handle.
 * @param {string} str
 * @returns {string} Base64-encoded string
 */
function encodeBase64Unicode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Build the GitHub Contents API URL for a file inside a repository.
 * @param {string} fullName  e.g. "user/my-repo"
 * @param {string} filePath  e.g. "LeetCode/1-two-sum.py"
 * @returns {string}
 */
function buildContentsUrl(fullName, filePath) {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return `${AceConstants.GITHUB.REPOS_API_URL}/${fullName}/contents/${encoded}`;
}

/**
 * Check whether a file already exists in the repository.
 * Returns { exists: boolean, sha: string|null, error: string|null }
 * @param {string} token
 * @param {string} fullName
 * @param {string} filePath
 * @param {string} branch
 */
async function checkFileExists(token, fullName, filePath, branch) {
  const url = `${buildContentsUrl(fullName, filePath)}?ref=${encodeURIComponent(branch)}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (response.status === 404) {
      return { exists: false, sha: null, error: null };
    }

    if (response.status === 401) {
      return { exists: false, sha: null, error: 'GitHub session expired. Please reconnect your account.' };
    }

    if (response.status === 403) {
      const data = await response.json().catch(() => ({}));
      // Rate limit
      if (data.message && data.message.toLowerCase().includes('rate limit')) {
        return { exists: false, sha: null, error: 'GitHub API rate limit exceeded. Please wait and try again.' };
      }
      return { exists: false, sha: null, error: `GitHub API forbidden (403): ${data.message || 'Access denied.'}` };
    }

    if (!response.ok) {
      return { exists: false, sha: null, error: `GitHub API error (${response.status}) while checking file.` };
    }

    const data = await response.json();
    return { exists: true, sha: data.sha || null, error: null };
  } catch (err) {
    return { exists: false, sha: null, error: `Network error while checking file: ${err.message}` };
  }
}

/**
 * Upload (create or update) a single file to GitHub via the Contents API.
 * @param {string} token
 * @param {string} fullName  e.g. "user/repo"
 * @param {string} filePath  e.g. "LeetCode/1-two-sum.py"
 * @param {string} branch
 * @param {string} content   Raw file content (not Base64)
 * @param {string} commitMessage
 * @param {string|null} existingSha  Pass if updating an existing file
 * @returns {Promise<{success: boolean, url?: string, error?: string, rateLimited?: boolean}>}
 */
async function uploadFileToGitHub(token, fullName, filePath, branch, content, commitMessage, existingSha) {
  const url = buildContentsUrl(fullName, filePath);
  const body = {
    message: commitMessage,
    content: encodeBase64Unicode(content),
    branch: branch
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify(body)
    });

    if (response.status === 401) {
      return { exists: false, sha: null, error: 'GitHub session expired. Please reconnect your account.' };
    }

    if (response.status === 403) {
      const data = await response.json().catch(() => ({}));
      if (data.message && data.message.toLowerCase().includes('rate limit')) {
        return { success: false, rateLimited: true, error: 'GitHub API rate limit exceeded. Please wait and try again.' };
      }
      return { success: false, error: `GitHub API forbidden (403): ${data.message || 'Access denied.'}` };
    }

    if (response.status === 409) {
      return { success: false, error: 'File conflict — the file was modified remotely. Please try again.' };
    }

    if (response.status === 422) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: `Validation error: ${data.message || 'Invalid request.'}` };
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: `GitHub API error (${response.status}): ${data.message || 'Upload failed.'}` };
    }

    const data = await response.json();
    const fileUrl = (data.content && data.content.html_url) || null;
    return { success: true, url: fileUrl };
  } catch (err) {
    return { success: false, error: `Network error during upload: ${err.message}` };
  }
}

/**
 * Upload an accepted submission to one or more destination folders.
 * Returns per-folder results so partial failures are handled gracefully.
 *
 * @param {object} payload
 *   {
 *     submissionUid: string,     — matches a confirmed submission record
 *     overwriteDecisions: object — { folderPath: 'overwrite'|'skip' }
 *   }
 */
async function uploadSolution({ submissionUid, overwriteDecisions = {} }) {
  // 1. Load confirmed submissions, repo, and token
  const stored = await chrome.storage.local.get([
    AceConstants.STORAGE_KEYS.CONFIRMED_SUBMISSIONS,
    AceConstants.STORAGE_KEYS.SELECTED_REPO,
    AceConstants.STORAGE_KEYS.AUTH_TOKEN
  ]);

  const token = stored[AceConstants.STORAGE_KEYS.AUTH_TOKEN] || null;
  if (!token) {
    return { success: false, error: 'Not authenticated with GitHub. Please reconnect your account.' };
  }

  const confirmedList = Array.isArray(stored[AceConstants.STORAGE_KEYS.CONFIRMED_SUBMISSIONS])
    ? stored[AceConstants.STORAGE_KEYS.CONFIRMED_SUBMISSIONS]
    : [];

  // Locate the confirmed submission
  const record = submissionUid
    ? confirmedList.find((r) => r.uid === submissionUid)
    : confirmedList[confirmedList.length - 1];

  if (!record) {
    return { success: false, error: 'No confirmed submission found to upload.' };
  }

  const repository = record.repository || stored[AceConstants.STORAGE_KEYS.SELECTED_REPO] || null;
  if (!repository || !repository.fullName) {
    return { success: false, error: 'No GitHub repository selected. Please select a repository.' };
  }

  const selectedFolders = Array.isArray(record.confirmedFolders) && record.confirmedFolders.length > 0
    ? record.confirmedFolders
    : null;

  if (!selectedFolders) {
    return { success: false, error: 'No destination folders selected for this submission.' };
  }

  const { fullName, defaultBranch } = repository;
  const branch = defaultBranch || 'main';

  // Specific Problem Folder: e.g. "0001-Two-Sum"
  const problemFolder = generateProblemFolderName(record);
  // Commit Message: Time: <time> ms (<time-percentile>%), Space: <memory> MB (<memory-percentile>%) - AceLC
  const commitMessage = generateComplexityCommitMessage(record);
  // PROBLEM.md content
  const problemMarkdownContent = generateProblemMarkdown(record);

  console.log('[AceLC Background] ========================================');
  console.log('[AceLC Background] Starting solution upload:');
  console.log(`  Problem Folder: ${problemFolder}`);
  console.log(`  Commit Message: ${commitMessage}`);
  console.log(`  Repository: ${fullName} (branch: ${branch})`);
  console.log(`  Destinations: ${JSON.stringify(selectedFolders)}`);
  console.log('[AceLC Background] ========================================');

  const results = [];
  let anySucceeded = false;

  // 2. Upload to each selected destination folder
  for (const destFolder of selectedFolders) {
    const normalizedDest = destFolder.replace(/\/+$/, '').replace(/^\/+/, '');
    const fullProblemPath = normalizedDest ? `${normalizedDest}/${problemFolder}` : problemFolder;
    const solutionFilePath = `${fullProblemPath}/SOLUTION.java`;
    const problemMdFilePath = `${fullProblemPath}/PROBLEM.md`;

    // 2a. Check if SOLUTION.java already exists
    const existCheck = await checkFileExists(token, fullName, solutionFilePath, branch);
    if (existCheck.error) {
      results.push({
        folder: destFolder,
        filePath: solutionFilePath,
        success: false,
        error: existCheck.error,
        skipped: false
      });
      continue;
    }

    // 2b. If file exists, check overwrite decision
    if (existCheck.exists) {
      const decision = overwriteDecisions[destFolder] || null;

      if (!decision) {
        // Prompt user for decision
        results.push({
          folder: destFolder,
          filePath: solutionFilePath,
          success: false,
          needsOverwriteConfirmation: true,
          existingSha: existCheck.sha,
          error: null,
          skipped: false
        });
        continue;
      }

      if (decision === 'skip') {
        results.push({
          folder: destFolder,
          filePath: solutionFilePath,
          success: true,
          skipped: true,
          error: null
        });
        anySucceeded = true;
        console.log(`[AceLC Background] Skipped existing problem folder: ${fullProblemPath}`);
        continue;
      }

      // Overwrite: Upload SOLUTION.java with existing SHA
      const uploadSolResult = await uploadFileToGitHub(
        token, fullName, solutionFilePath, branch,
        record.code, commitMessage, existCheck.sha
      );

      // Check PROBLEM.md SHA to overwrite or create
      const mdExistCheck = await checkFileExists(token, fullName, problemMdFilePath, branch);
      await uploadFileToGitHub(
        token, fullName, problemMdFilePath, branch,
        problemMarkdownContent, commitMessage, mdExistCheck.sha || null
      );

      results.push({
        folder: destFolder,
        filePath: solutionFilePath,
        problemFolderPath: fullProblemPath,
        success: uploadSolResult.success,
        overwritten: uploadSolResult.success,
        url: uploadSolResult.url || null,
        error: uploadSolResult.success ? null : uploadSolResult.error,
        rateLimited: uploadSolResult.rateLimited || false,
        skipped: false
      });

      if (uploadSolResult.success) {
        anySucceeded = true;
        console.log(`[AceLC Background] Overwritten: ${fullProblemPath}`);
      } else {
        console.warn(`[AceLC Background] Overwrite failed for ${solutionFilePath}: ${uploadSolResult.error}`);
      }
      continue;
    }

    // 2c. Files do not exist — create SOLUTION.java & PROBLEM.md inside the problem folder
    const uploadSolResult = await uploadFileToGitHub(
      token, fullName, solutionFilePath, branch,
      record.code, commitMessage, null
    );

    let mdUrl = null;
    if (uploadSolResult.success) {
      const uploadMdResult = await uploadFileToGitHub(
        token, fullName, problemMdFilePath, branch,
        problemMarkdownContent, commitMessage, null
      );
      mdUrl = uploadMdResult.url || null;
    }

    results.push({
      folder: destFolder,
      filePath: solutionFilePath,
      problemFolderPath: fullProblemPath,
      success: uploadSolResult.success,
      url: uploadSolResult.url || null,
      mdUrl: mdUrl,
      error: uploadSolResult.success ? null : uploadSolResult.error,
      rateLimited: uploadSolResult.rateLimited || false,
      skipped: false
    });

    if (uploadSolResult.success) {
      anySucceeded = true;
      console.log(`[AceLC Background] Uploaded folder: ${fullProblemPath}`);
    } else {
      console.warn(`[AceLC Background] Upload failed for ${solutionFilePath}: ${uploadSolResult.error}`);
    }
  }

  // 3. Update stats, upload history & repository README.md if at least one upload succeeded
  const needsConfirmation = results.some((r) => r.needsOverwriteConfirmation);

  if (anySucceeded && !needsConfirmation) {
    try {
      // Record primary folder path relative to repo root
      const primaryResult = results.find((r) => r.success && !r.skipped) || results[0];
      record.primaryFolderRelative = primaryResult ? primaryResult.problemFolderPath : problemFolder;

      // Update local statistics and upload history
      const { history } = await recordSuccessfulUploadInStats(record);

      // Create or update GitHub repository README.md dashboard
      const readmePath = 'README.md';
      const readmeCheck = await fetchFileContent(token, fullName, readmePath, branch);
      const newReadmeContent = buildOrUpdateRepositoryReadme(readmeCheck.content, history);
      await uploadFileToGitHub(
        token, fullName, readmePath, branch,
        newReadmeContent,
        `Update README dashboard - AceLC`,
        readmeCheck.sha || null
      );
      console.log('[AceLC Background] Repository README.md dashboard successfully updated.');
    } catch (readmeErr) {
      console.warn('[AceLC Background] Failed updating README dashboard (non-fatal):', readmeErr);
    }
  }

  if (!needsConfirmation) {
    const updatedConfirmed = confirmedList.filter((r) => r.uid !== record.uid);
    await chrome.storage.local.set({
      [AceConstants.STORAGE_KEYS.CONFIRMED_SUBMISSIONS]: updatedConfirmed
    });
  }

  const allSucceeded = results.every((r) => r.success || r.skipped);
  const anyFailed = results.some((r) => !r.success && !r.skipped && !r.needsOverwriteConfirmation);

  console.log('[AceLC Background] Upload results summary:');
  for (const r of results) {
    if (r.success && r.skipped) console.log(`  SKIPPED  : ${r.filePath}`);
    else if (r.success && r.overwritten) console.log(`  UPDATED  : ${r.filePath} → ${r.url || 'no URL'}`);
    else if (r.success) console.log(`  CREATED  : ${r.filePath} → ${r.url || 'no URL'}`);
    else if (r.needsOverwriteConfirmation) console.log(`  CONFLICT : ${r.filePath} (needs overwrite confirmation)`);
    else console.log(`  FAILED   : ${r.filePath} — ${r.error}`);
  }

  return {
    success: anySucceeded || (results.every((r) => r.skipped)),
    results,
    needsOverwriteConfirmation: needsConfirmation,
    allSucceeded,
    anyFailed,
    filename: 'SOLUTION.java',
    problemFolder,
    repository: { fullName, branch }
  };
}

/**
 * =========================================================================
 * SUBMISSION MANAGEMENT (PHASE 5)
 * =========================================================================
 */

// In-memory cache for background deduplication: submissionKey -> timestamp
const processedSubmissionsCache = new Map();

/**
 * Update extension action badge with current pending submissions count
 * @param {number} count 
 */
function updateExtensionBadge(count) {
  try {
    if (typeof chrome.action !== 'undefined' && chrome.action.setBadgeText) {
      const text = count > 0 ? String(count) : '';
      chrome.action.setBadgeText({ text });
      if (count > 0 && chrome.action.setBadgeBackgroundColor) {
        chrome.action.setBadgeBackgroundColor({ color: '#2da44e' });
      }
    }
  } catch (err) {
    // Action API not available in some contexts
  }
}

/**
 * Handle and persist verified accepted submissions detected from LeetCode
 * @param {object} submission 
 * @param {number|null} senderTabId
 * @returns {Promise<{success: boolean, duplicate?: boolean, submission?: object, error?: string}>}
 */
async function handleAcceptedSubmission(submission, senderTabId = null) {
  if (!submission || typeof submission !== 'object') {
    return { success: false, error: 'Invalid submission payload.' };
  }

  const { problemTitle, problemSlug, code, language, submissionId } = submission;

  if (!problemSlug || typeof problemSlug !== 'string') {
    return { success: false, error: 'Submission missing valid problem slug.' };
  }

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return { success: false, error: 'Submission missing valid source code.' };
  }

  if (!language || typeof language !== 'string') {
    return { success: false, error: 'Submission missing valid programming language.' };
  }

  const now = Date.now();

  // Purge expired entries (> 5 minutes old)
  for (const [key, timestamp] of processedSubmissionsCache.entries()) {
    if (now - timestamp > 300000) {
      processedSubmissionsCache.delete(key);
    }
  }

  // Generate deduplication key
  const dedupKey = submissionId
    ? `id_${submissionId}`
    : `slug_${problemSlug}_${code.length}_${Math.floor(now / 30000)}`;

  if (processedSubmissionsCache.has(dedupKey)) {
    const lastSeen = processedSubmissionsCache.get(dedupKey);
    if (now - lastSeen < 60000) {
      console.log(`[AceLC Background] Duplicate submission ignored (${dedupKey}).`);
      return {
        success: true,
        duplicate: true,
        message: 'Duplicate accepted submission already recorded.'
      };
    }
  }

  processedSubmissionsCache.set(dedupKey, now);

  const uid = 'sub_' + now + '_' + Math.random().toString(36).slice(2, 8);

  const submissionRecord = {
    uid: uid,
    problemTitle: problemTitle || problemSlug,
    problemSlug: problemSlug,
    problemUrl: submission.problemUrl || `https://leetcode.com/problems/${problemSlug}/`,
    problemNumber: submission.problemNumber || null,
    difficulty: submission.difficulty || 'Medium',
    statement: submission.statement || '',
    code: code,
    language: language,
    languageId: submission.languageId || language.toLowerCase(),
    languageExt: submission.languageExt || '.txt',
    submissionId: submissionId || null,
    runtime: submission.runtime || null,
    memory: submission.memory || null,
    runtimePercentile: submission.runtimePercentile || null,
    memoryPercentile: submission.memoryPercentile || null,
    detectedAt: now
  };

  // 1. Maintain queue of pending submissions (Phase 6)
  const queueResult = await chrome.storage.local.get([
    AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE,
    AceConstants.STORAGE_KEYS.SELECTED_REPO,
    AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS
  ]);

  let queue = Array.isArray(queueResult[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE])
    ? queueResult[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE]
    : [];

  // Filter out any stale items older than 24 hours
  const cutoff = now - (24 * 60 * 60 * 1000);
  queue = queue.filter((item) => item && item.detectedAt && item.detectedAt > cutoff);

  // Add the newly detected submission to the pending queue
  queue.push(submissionRecord);

  // Update storage with queue and single pending submission
  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE]: queue,
    [AceConstants.STORAGE_KEYS.PENDING_SUBMISSION]: submissionRecord
  });

  updateExtensionBadge(queue.length);

  const selectedRepo = queueResult[AceConstants.STORAGE_KEYS.SELECTED_REPO] || null;
  const destinationFolders = Array.isArray(queueResult[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS])
    ? queueResult[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]
    : [];

  console.log('[AceLC Background] ========================================');
  console.log('[AceLC Background] Accepted LeetCode Submission Received:');
  console.log(`  UID: ${submissionRecord.uid}`);
  console.log(`  Problem: [${submissionRecord.problemNumber || '?'}] ${submissionRecord.problemTitle} (${submissionRecord.problemSlug})`);
  console.log(`  Language: ${submissionRecord.language} (${submissionRecord.languageExt})`);
  console.log(`  Code length: ${submissionRecord.code.length} characters`);
  if (submissionRecord.submissionId) console.log(`  Submission ID: ${submissionRecord.submissionId}`);
  if (submissionRecord.runtime) console.log(`  Runtime: ${submissionRecord.runtime}`);
  if (submissionRecord.memory) console.log(`  Memory: ${submissionRecord.memory}`);
  console.log(`  Pending queue length: ${queue.length}`);
  console.log('[AceLC Background] ========================================');

  // Trigger in-page destination selection interface on the LeetCode tab
  if (senderTabId) {
    chrome.tabs.sendMessage(senderTabId, {
      action: AceConstants.MESSAGES.SHOW_DESTINATION_MODAL,
      submission: submissionRecord,
      repository: selectedRepo,
      folders: destinationFolders,
      queueLength: queue.length
    }).catch(() => {
      // Content script might be reloading
    });
  }

  return {
    success: true,
    submission: submissionRecord,
    repository: selectedRepo,
    folders: destinationFolders,
    queueLength: queue.length,
    message: 'Accepted submission successfully captured and saved.'
  };
}

/**
 * Retrieve all pending submissions in the queue along with repo and folder configuration
 */
async function getPendingQueue() {
  const result = await chrome.storage.local.get([
    AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE,
    AceConstants.STORAGE_KEYS.SELECTED_REPO,
    AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS
  ]);

  const queue = Array.isArray(result[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE])
    ? result[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE]
    : [];
  const repository = result[AceConstants.STORAGE_KEYS.SELECTED_REPO] || null;
  const folders = Array.isArray(result[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS])
    ? result[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]
    : [];

  return {
    success: true,
    queue,
    repository,
    folders
  };
}

/**
 * Confirm destination selection for a pending submission
 * @param {object} payload { submissionUid: string, selectedFolders: Array<string> }
 */
async function confirmDestinationSelection({ submissionUid, selectedFolders }) {
  if (!selectedFolders || !Array.isArray(selectedFolders) || selectedFolders.length === 0) {
    return { success: false, error: 'At least one destination folder must be selected.' };
  }

  const result = await chrome.storage.local.get([
    AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE,
    AceConstants.STORAGE_KEYS.CONFIRMED_SUBMISSIONS,
    AceConstants.STORAGE_KEYS.SELECTED_REPO
  ]);

  let queue = Array.isArray(result[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE])
    ? result[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE]
    : [];
  let confirmedList = Array.isArray(result[AceConstants.STORAGE_KEYS.CONFIRMED_SUBMISSIONS])
    ? result[AceConstants.STORAGE_KEYS.CONFIRMED_SUBMISSIONS]
    : [];
  const selectedRepo = result[AceConstants.STORAGE_KEYS.SELECTED_REPO] || null;

  // Locate the target submission by UID, or the oldest if no UID given
  const targetIndex = submissionUid
    ? queue.findIndex((s) => s.uid === submissionUid)
    : 0;

  if (targetIndex === -1 || !queue[targetIndex]) {
    return { success: false, error: 'Target submission was not found in the pending queue.' };
  }

  const targetSubmission = queue[targetIndex];
  const confirmedRecord = {
    ...targetSubmission,
    confirmedFolders: selectedFolders,
    repository: selectedRepo,
    confirmedAt: Date.now()
  };

  // Remove confirmed item from pending queue
  queue.splice(targetIndex, 1);
  confirmedList.push(confirmedRecord);

  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE]: queue,
    [AceConstants.STORAGE_KEYS.CONFIRMED_SUBMISSIONS]: confirmedList,
    [AceConstants.STORAGE_KEYS.PENDING_SUBMISSION]: queue.length > 0 ? queue[0] : null
  });

  updateExtensionBadge(queue.length);

  console.log('[AceLC Background] ========================================');
  console.log('[AceLC Background] Destination Selection Confirmed:');
  console.log(`  Problem: [${confirmedRecord.problemNumber || '?'}] ${confirmedRecord.problemTitle} (${confirmedRecord.problemSlug})`);
  console.log(`  Language: ${confirmedRecord.language} (${confirmedRecord.languageExt})`);
  console.log(`  Repository: ${selectedRepo ? selectedRepo.fullName : 'None'}`);
  console.log(`  Selected Folders: ${JSON.stringify(selectedFolders)}`);
  console.log(`  UID: ${confirmedRecord.uid}`);
  console.log(`  Remaining in queue: ${queue.length}`);
  console.log('[AceLC Background] ========================================');

  return {
    success: true,
    confirmedSubmission: confirmedRecord,
    remainingCount: queue.length
  };
}

/**
 * Cancel destination selection for a pending submission
 * @param {object} payload { submissionUid: string }
 */
async function cancelDestinationSelection({ submissionUid }) {
  const result = await chrome.storage.local.get(AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE);
  let queue = Array.isArray(result[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE])
    ? result[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE]
    : [];

  const targetIndex = submissionUid
    ? queue.findIndex((s) => s.uid === submissionUid)
    : 0;

  if (targetIndex !== -1 && queue[targetIndex]) {
    const cancelled = queue.splice(targetIndex, 1)[0];
    console.log(`[AceLC Background] Pending submission cancelled: ${cancelled.problemSlug} (${cancelled.uid})`);
  }

  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE]: queue,
    [AceConstants.STORAGE_KEYS.PENDING_SUBMISSION]: queue.length > 0 ? queue[0] : null
  });

  updateExtensionBadge(queue.length);

  return { success: true, remainingCount: queue.length };
}

/**
 * Retrieve the current pending submission from storage
 */
async function getPendingSubmission() {
  const result = await chrome.storage.local.get(AceConstants.STORAGE_KEYS.PENDING_SUBMISSION);
  return {
    success: true,
    submission: result[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION] || null
  };
}

/**
 * Clear the pending submission from storage
 */
async function clearPendingSubmission() {
  await chrome.storage.local.remove(AceConstants.STORAGE_KEYS.PENDING_SUBMISSION);
  return { success: true };
}

/**
 * Handle resetting statistics and clearing the repository README dashboard
 * @returns {Promise<{ success: boolean, error?: string, warning?: string }>}
 */
async function handleResetStats() {
  const emptyStats = { total: 0, easy: 0, medium: 0, hard: 0, lastUpdated: Date.now() };
  await chrome.storage.local.set({
    [AceConstants.STORAGE_KEYS.STATS]: emptyStats,
    [AceConstants.STORAGE_KEYS.UPLOAD_HISTORY]: []
  });

  try {
    const stored = await chrome.storage.local.get([
      AceConstants.STORAGE_KEYS.AUTH_TOKEN,
      AceConstants.STORAGE_KEYS.SELECTED_REPO
    ]);
    const token = stored[AceConstants.STORAGE_KEYS.AUTH_TOKEN];
    const repo = stored[AceConstants.STORAGE_KEYS.SELECTED_REPO];

    if (token && repo && repo.full_name) {
      const branch = repo.default_branch || 'main';
      const readmeRes = await fetchFileContent(token, repo.full_name, 'README.md', branch);
      if (readmeRes.exists && readmeRes.content) {
        const updatedReadme = buildOrUpdateRepositoryReadme(readmeRes.content, []);
        const uploadRes = await uploadFileToGitHub(
          token,
          repo.full_name,
          'README.md',
          updatedReadme,
          'Reset AceLC problem solving dashboard - AceLC',
          branch,
          readmeRes.sha
        );
        if (!uploadRes.success) {
          console.warn('[AceLC Background] Could not update README on reset:', uploadRes.error);
          return { success: true, warning: 'Local stats reset, but could not update README on GitHub: ' + uploadRes.error };
        }
      }
    }
  } catch (err) {
    console.warn('[AceLC Background] Error during repository README reset:', err.message);
  }

  return { success: true };
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

  // Folder actions (Phase 4)
  if (message.action === AceConstants.MESSAGES.GET_REPO_DIRECTORIES) {
    fetchRepoDirectories().then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.GET_DESTINATION_FOLDERS) {
    getDestinationFolders().then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.ADD_DESTINATION_FOLDER) {
    addDestinationFolder(message.folderPath).then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.REMOVE_DESTINATION_FOLDER) {
    removeDestinationFolder(message.folderPath).then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.SET_DESTINATION_FOLDERS) {
    setDestinationFolders(message.folders || []).then(sendResponse);
    return true;
  }

  // Submission actions (Phase 5)
  if (message.action === AceConstants.MESSAGES.SUBMISSION_DETECTED) {
    const senderTabId = (sender && sender.tab) ? sender.tab.id : null;
    handleAcceptedSubmission(message.submission, senderTabId).then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.GET_PENDING_SUBMISSION) {
    getPendingSubmission().then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.CLEAR_PENDING_SUBMISSION) {
    clearPendingSubmission().then(sendResponse);
    return true;
  }

  // Destination Selection actions (Phase 6)
  if (message.action === AceConstants.MESSAGES.GET_PENDING_QUEUE) {
    getPendingQueue().then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.CONFIRM_DESTINATION_SELECTION) {
    confirmDestinationSelection(message.payload || {}).then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.CANCEL_DESTINATION_SELECTION) {
    cancelDestinationSelection(message.payload || {}).then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.GET_STATUS) {
    sendResponse({
      success: true,
      name: AceConstants.EXTENSION_NAME,
      version: AceConstants.VERSION,
      phase: 'Phase 7: GitHub Solution Uploading'
    });
    return false;
  }

  // Upload actions (Phase 7)
  if (message.action === AceConstants.MESSAGES.UPLOAD_SOLUTION) {
    uploadSolution(message.payload || {}).then(sendResponse);
    return true;
  }

  if (message.action === AceConstants.MESSAGES.CHECK_FILE_EXISTS) {
    const { fullName, filePath, branch } = message.payload || {};
    getStoredToken().then((token) => {
      if (!token) {
        sendResponse({ success: false, error: 'Not authenticated.' });
        return;
      }
      checkFileExists(token, fullName, filePath, branch).then((r) =>
        sendResponse({ success: true, ...r })
      );
    });
    return true;
  }

  if (message.action === AceConstants.MESSAGES.GET_STATS) {
    chrome.storage.local.get(
      [AceConstants.STORAGE_KEYS.STATS, AceConstants.STORAGE_KEYS.UPLOAD_HISTORY],
      (result) => {
        const stats = result[AceConstants.STORAGE_KEYS.STATS] || {
          total: 0,
          easy: 0,
          medium: 0,
          hard: 0
        };
        const history = result[AceConstants.STORAGE_KEYS.UPLOAD_HISTORY] || [];
        sendResponse({ success: true, stats, history });
      }
    );
    return true;
  }

  if (message.action === AceConstants.MESSAGES.RESET_STATS) {
    handleResetStats().then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  sendResponse({ success: false, error: 'Unhandled action' });
  return false;
});
