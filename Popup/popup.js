/**
 * AceLC - Popup Script
 * Coordinates GitHub authentication UI states, user actions, repository selection,
 * and destination folder management.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Auth State Containers
  const stateNotConnected = document.getElementById('stateNotConnected');
  const stateWaitingAuth = document.getElementById('stateWaitingAuth');
  const stateConnected = document.getElementById('stateConnected');
  const stateAuthFailed = document.getElementById('stateAuthFailed');

  // DOM Elements - Auth Inputs & Controls
  const clientIdInput = document.getElementById('clientIdInput');
  const connectBtn = document.getElementById('connectBtn');
  const userCodeDisplay = document.getElementById('userCodeDisplay');
  const copyCodeBtn = document.getElementById('copyCodeBtn');
  const openVerifyBtn = document.getElementById('openVerifyBtn');
  const checkAuthBtn = document.getElementById('checkAuthBtn');
  const cancelAuthBtn = document.getElementById('cancelAuthBtn');
  const retryAuthBtn = document.getElementById('retryAuthBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const openOptionsBtn = document.getElementById('openOptionsBtn');

  // DOM Elements - User Profile Display
  const userAvatarLink = document.getElementById('userAvatarLink');
  const userAvatar = document.getElementById('userAvatar');
  const userNameLink = document.getElementById('userNameLink');
  const userName = document.getElementById('userName');
  const userHandle = document.getElementById('userHandle');
  const authErrorMessage = document.getElementById('authErrorMessage');
  const feedbackToast = document.getElementById('feedbackToast');

  const LEETCODE_PROFILE_URL = 'https://leetcode.com/u/Aswin_Salish/';

  function openProfileTab(e) {
    if (e) e.preventDefault();
    const targetUrl = (e && e.currentTarget && e.currentTarget.id === 'userNameLink')
      ? LEETCODE_PROFILE_URL
      : ((e && e.currentTarget && e.currentTarget.href && e.currentTarget.href !== '#' && !e.currentTarget.href.endsWith('#'))
        ? e.currentTarget.href
        : (userHandle && userHandle.href));
    if (targetUrl && targetUrl !== '#' && !targetUrl.endsWith('#')) {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: targetUrl });
      } else {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    }
  }

  if (userAvatarLink) userAvatarLink.addEventListener('click', openProfileTab);
  if (userNameLink) userNameLink.addEventListener('click', openProfileTab);
  if (userHandle) userHandle.addEventListener('click', openProfileTab);

  // DOM Elements - Repository Management (Phase 3)
  const repoActiveView = document.getElementById('repoActiveView');
  const repoVisibilityBadge = document.getElementById('repoVisibilityBadge');
  const repoNameLink = document.getElementById('repoNameLink');
  const changeRepoBtn = document.getElementById('changeRepoBtn');

  const repoConfigView = document.getElementById('repoConfigView');
  const repoSelectMode = document.getElementById('repoSelectMode');
  const repoCreateMode = document.getElementById('repoCreateMode');
  const repoDropdown = document.getElementById('repoDropdown');
  const confirmSelectRepoBtn = document.getElementById('confirmSelectRepoBtn');
  const switchToCreateRepoBtn = document.getElementById('switchToCreateRepoBtn');
  const refreshReposBtn = document.getElementById('refreshReposBtn');
  const cancelChangeRepoBtn = document.getElementById('cancelChangeRepoBtn');

  const newRepoName = document.getElementById('newRepoName');
  const newRepoDesc = document.getElementById('newRepoDesc');
  const repoNameValidationMsg = document.getElementById('repoNameValidationMsg');
  const createRepoErrorMsg = document.getElementById('createRepoErrorMsg');
  const submitCreateRepoBtn = document.getElementById('submitCreateRepoBtn');
  const cancelCreateModeBtn = document.getElementById('cancelCreateModeBtn');

  // DOM Elements - Folder Management (Phase 4)
  const foldersCountBadge = document.getElementById('foldersCountBadge');
  const configuredFoldersList = document.getElementById('configuredFoldersList');
  const newFolderInput = document.getElementById('newFolderInput');
  const addFolderBtn = document.getElementById('addFolderBtn');
  const folderValidationMsg = document.getElementById('folderValidationMsg');
  const existingDirectoriesGroup = document.getElementById('existingDirectoriesGroup');
  const existingDirectoriesDropdown = document.getElementById('existingDirectoriesDropdown');
  const addExistingDirBtn = document.getElementById('addExistingDirBtn');

  // DOM Elements - Destination Selection Interface (Phase 6)
  const destSelectionCard = document.getElementById('destSelectionCard');
  const destQueueBadge = document.getElementById('destQueueBadge');
  const destProblemTitle = document.getElementById('destProblemTitle');
  const destLanguageBadge = document.getElementById('destLanguageBadge');
  const destRuntimeBadge = document.getElementById('destRuntimeBadge');
  const destMemoryBadge = document.getElementById('destMemoryBadge');
  const destRepoName = document.getElementById('destRepoName');
  const destFoldersChecklist = document.getElementById('destFoldersChecklist');
  const destSelectAllBtn = document.getElementById('destSelectAllBtn');
  const destValidationMsg = document.getElementById('destValidationMsg');
  const destConfirmBtn = document.getElementById('destConfirmBtn');
  const destCancelBtn = document.getElementById('destCancelBtn');
  const destQueueNav = document.getElementById('destQueueNav');
  const destPrevBtn = document.getElementById('destPrevBtn');
  const destNextBtn = document.getElementById('destNextBtn');
  const destQueueNavText = document.getElementById('destQueueNavText');

  // DOM Elements - Statistics Dashboard
  const statsDashboard = document.getElementById('statsDashboard');
  const statsGreetingText = document.getElementById('statsGreetingText');
  const statTotalSolved = document.getElementById('statTotalSolved');
  const statEasySolved = document.getElementById('statEasySolved');
  const statMediumSolved = document.getElementById('statMediumSolved');
  const statHardSolved = document.getElementById('statHardSolved');
  const resetStatsBtn = document.getElementById('resetStatsBtn');

  let activeVerificationUri = AceConstants.GITHUB.VERIFICATION_URL;
  let activeUserCode = '';
  let cachedRepositories = [];
  let currentSelectedRepo = null;
  let configuredFolders = [];
  let pendingSubmissionsQueue = [];
  let currentQueueIndex = 0;

  /**
   * Show feedback toast notification
   */
  function showToast(message, isError = false) {
    if (!feedbackToast) return;
    feedbackToast.textContent = message;
    feedbackToast.className = isError ? 'toast toast-error' : 'toast';
    feedbackToast.classList.remove('hidden');

    setTimeout(() => {
      feedbackToast.classList.add('hidden');
    }, 3500);
  }

  /**
   * Switch visible state container
   */
  function setViewState(view) {
    stateNotConnected.classList.add('hidden');
    stateWaitingAuth.classList.add('hidden');
    stateConnected.classList.add('hidden');
    stateAuthFailed.classList.add('hidden');

    if (view === AceConstants.AUTH_STATUS.CONNECTED) {
      stateConnected.classList.remove('hidden');
    } else if (view === AceConstants.AUTH_STATUS.WAITING_FOR_AUTH) {
      stateWaitingAuth.classList.remove('hidden');
    } else if (view === AceConstants.AUTH_STATUS.FAILED) {
      stateAuthFailed.classList.remove('hidden');
    } else {
      stateNotConnected.classList.remove('hidden');
    }
  }

  /**
   * Client-side repository name validation
   */
  function validateRepoNameInput(name) {
    if (!name || typeof name !== 'string') return 'Repository name is required.';
    const trimmed = name.trim();
    if (trimmed.length === 0) return 'Repository name cannot be empty.';
    if (trimmed.length > 100) return 'Repository name cannot exceed 100 characters.';
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      return 'Can only contain letters, numbers, hyphens, periods, and underscores.';
    }
    if (trimmed.startsWith('-') || trimmed.startsWith('.')) {
      return 'Cannot start with a hyphen or period.';
    }
    if (trimmed.toLowerCase().endsWith('.git')) {
      return 'Cannot end with .git.';
    }
    return null;
  }

  /**
   * Client-side folder path validation
   */
  function validateFolderPathInput(path) {
    if (!path || typeof path !== 'string') return 'Folder path cannot be empty.';
    const cleaned = path.trim().replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '');
    if (!cleaned) return 'Folder path cannot be empty.';
    if (cleaned.length > 200) return 'Folder path cannot exceed 200 characters.';

    const segments = cleaned.split('/');
    for (const seg of segments) {
      const trimmedSeg = seg.trim();
      if (!trimmedSeg) return 'Path contains an empty segment.';
      if (trimmedSeg === '.' || trimmedSeg === '..') return 'Path cannot contain "." or "..".';
      if (trimmedSeg.toLowerCase() === '.git') return 'Path cannot contain ".git".';
      if (!/^[a-zA-Z0-9_\-. ]+$/.test(trimmedSeg)) {
        return 'Only letters, numbers, hyphens, underscores, dots, and spaces allowed.';
      }
    }
    return null;
  }

  /**
   * Render Connected State
   */
  function renderConnected(user) {
    if (!user) return;
    const profileUrl = user.htmlUrl || `https://github.com/${user.login}`;
    userName.textContent = user.name || user.login;
    userHandle.textContent = `@${user.login}`;
    userHandle.href = profileUrl;

    if (userAvatarLink) userAvatarLink.href = profileUrl;
    if (userNameLink) {
      userNameLink.href = LEETCODE_PROFILE_URL;
      userNameLink.title = 'Open LeetCode Profile';
    }

    if (user.avatarUrl) {
      userAvatar.src = user.avatarUrl;
      userAvatar.alt = `${user.login}'s Avatar`;
    } else {
      userAvatar.src = '';
      userAvatar.alt = 'User Avatar';
    }

    setViewState(AceConstants.AUTH_STATUS.CONNECTED);
    loadSelectedRepository();
  }

  /**
   * Render Waiting for Authorization State
   */
  function renderWaitingAuth() {
    setViewState(AceConstants.AUTH_STATUS.WAITING_FOR_AUTH);
  }

  /**
   * Render Failed State
   */
  function renderAuthFailed(message) {
    authErrorMessage.textContent = message || 'An error occurred during authentication.';
    setViewState(AceConstants.AUTH_STATUS.FAILED);
  }

  /**
   * =========================================================================
   * REPOSITORY MANAGEMENT LOGIC (PHASE 3)
   * =========================================================================
   */

  /**
   * Render active selected repository card and initialize folder management
   */
  function renderSelectedRepo(repo) {
    currentSelectedRepo = repo;

    if (repo && repo.fullName) {
      repoNameLink.textContent = repo.fullName;
      repoNameLink.href = repo.htmlUrl || `https://github.com/${repo.fullName}`;

      const activeRepoTag = document.getElementById('activeRepoTag');
      if (activeRepoTag) {
        activeRepoTag.textContent = repo.name || repo.fullName;
      }

      const isPrivate = Boolean(repo.isPrivate);
      repoVisibilityBadge.textContent = isPrivate ? 'Private' : 'Public';
      repoVisibilityBadge.className = isPrivate ? 'repo-badge badge-private' : 'repo-badge badge-public';

      repoActiveView.classList.remove('hidden');
      repoConfigView.classList.add('hidden');

      // Load folder structure and configured destination folders (Phase 4)
      loadDestinationFolders();
      loadExistingDirectories();
    } else {
      repoActiveView.classList.add('hidden');
      repoConfigView.classList.remove('hidden');
      showSelectMode();
      loadUserRepositories();
    }
  }

  function showSelectMode() {
    repoSelectMode.classList.remove('hidden');
    repoCreateMode.classList.add('hidden');
    if (cancelChangeRepoBtn) {
      if (currentSelectedRepo) {
        cancelChangeRepoBtn.classList.remove('hidden');
      } else {
        cancelChangeRepoBtn.classList.add('hidden');
      }
    }
  }

  function showCreateMode() {
    repoSelectMode.classList.add('hidden');
    repoCreateMode.classList.remove('hidden');
    newRepoName.value = '';
    newRepoDesc.value = '';
    repoNameValidationMsg.classList.add('hidden');
    createRepoErrorMsg.classList.add('hidden');
  }

  function loadSelectedRepository() {
    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_SELECTED_REPO }, (response) => {
      if (response && response.success) {
        renderSelectedRepo(response.repository);
      } else {
        renderSelectedRepo(null);
      }
    });
  }

  function loadUserRepositories() {
    repoDropdown.innerHTML = '<option value="">Loading repositories...</option>';
    confirmSelectRepoBtn.disabled = true;

    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_REPOSITORIES }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        const errorText = (response && response.error) || 'Failed to load repositories.';
        repoDropdown.innerHTML = `<option value="">Error: ${errorText}</option>`;
        showToast(errorText, true);
        return;
      }

      cachedRepositories = Array.isArray(response.repositories) ? response.repositories : [];

      if (cachedRepositories.length === 0) {
        repoDropdown.innerHTML = '<option value="">No repositories found</option>';
        return;
      }

      repoDropdown.innerHTML = '<option value="">Select a repository</option>';
      for (const repo of cachedRepositories) {
        const option = document.createElement('option');
        option.value = repo.fullName;
        option.textContent = `${repo.name} (${repo.isPrivate ? 'Private' : 'Public'})`;

        if (currentSelectedRepo && currentSelectedRepo.fullName === repo.fullName) {
          option.selected = true;
          confirmSelectRepoBtn.disabled = false;
        }

        repoDropdown.appendChild(option);
      }
    });
  }

  if (repoDropdown) {
    repoDropdown.addEventListener('change', () => {
      confirmSelectRepoBtn.disabled = !repoDropdown.value;
    });
  }

  if (confirmSelectRepoBtn) {
    confirmSelectRepoBtn.addEventListener('click', () => {
      const selectedFullName = repoDropdown.value;
      const foundRepo = cachedRepositories.find((r) => r.fullName === selectedFullName);

      if (!foundRepo) {
        showToast('Please select a valid repository.', true);
        return;
      }

      confirmSelectRepoBtn.disabled = true;
      confirmSelectRepoBtn.textContent = 'Saving...';

      chrome.runtime.sendMessage(
        {
          action: AceConstants.MESSAGES.SELECT_REPOSITORY,
          repository: foundRepo
        },
        (response) => {
          confirmSelectRepoBtn.disabled = false;
          confirmSelectRepoBtn.textContent = 'Select Repository';

          if (response && response.success) {
            showToast('Repository selected successfully!');
            renderSelectedRepo(response.repository);
          } else {
            showToast((response && response.error) || 'Failed to select repository.', true);
          }
        }
      );
    });
  }

  if (changeRepoBtn) {
    changeRepoBtn.addEventListener('click', () => {
      repoActiveView.classList.add('hidden');
      repoConfigView.classList.remove('hidden');
      showSelectMode();
      loadUserRepositories();
    });
  }

  if (cancelChangeRepoBtn) {
    cancelChangeRepoBtn.addEventListener('click', () => {
      if (currentSelectedRepo) {
        renderSelectedRepo(currentSelectedRepo);
      }
    });
  }

  if (switchToCreateRepoBtn) {
    switchToCreateRepoBtn.addEventListener('click', () => {
      showCreateMode();
    });
  }

  if (cancelCreateModeBtn) {
    cancelCreateModeBtn.addEventListener('click', () => {
      showSelectMode();
    });
  }

  if (newRepoName) {
    newRepoName.addEventListener('input', () => {
      const err = validateRepoNameInput(newRepoName.value);
      if (err) {
        repoNameValidationMsg.textContent = err;
        repoNameValidationMsg.classList.remove('hidden');
      } else {
        repoNameValidationMsg.classList.add('hidden');
      }
    });
  }

  if (submitCreateRepoBtn) {
    submitCreateRepoBtn.addEventListener('click', () => {
      const name = newRepoName.value.trim();
      const description = newRepoDesc.value.trim();
      const visibilityInput = document.querySelector('input[name="newRepoVisibility"]:checked');
      const isPrivate = visibilityInput ? visibilityInput.value === 'private' : false;

      const validationErr = validateRepoNameInput(name);
      if (validationErr) {
        repoNameValidationMsg.textContent = validationErr;
        repoNameValidationMsg.classList.remove('hidden');
        return;
      }

      submitCreateRepoBtn.disabled = true;
      submitCreateRepoBtn.textContent = 'Creating...';
      createRepoErrorMsg.classList.add('hidden');

      chrome.runtime.sendMessage(
        {
          action: AceConstants.MESSAGES.CREATE_REPOSITORY,
          payload: {
            name: name,
            description: description,
            isPrivate: isPrivate
          }
        },
        (response) => {
          submitCreateRepoBtn.disabled = false;
          submitCreateRepoBtn.textContent = 'Create Repository';

          if (response && response.success && response.repository) {
            showToast(`Repository '${response.repository.name}' created!`);
            renderSelectedRepo(response.repository);
          } else {
            const err = (response && response.error) || 'Failed to create repository.';
            createRepoErrorMsg.textContent = err;
            createRepoErrorMsg.classList.remove('hidden');
          }
        }
      );
    });
  }

  if (refreshReposBtn) {
    refreshReposBtn.addEventListener('click', () => {
      loadUserRepositories();
      showToast('Refreshing repositories...');
    });
  }

  /**
   * =========================================================================
   * FOLDER MANAGEMENT LOGIC (PHASE 4)
   * =========================================================================
   */

  /**
   * Load and render currently configured destination folders
   */
  function loadDestinationFolders() {
    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_DESTINATION_FOLDERS }, (response) => {
      if (response && response.success && Array.isArray(response.folders)) {
        configuredFolders = response.folders;
      } else {
        configuredFolders = [];
      }
      renderDestinationFoldersList();
    });
  }

  /**
   * Render destination folder tags
   */
  function renderDestinationFoldersList() {
    configuredFoldersList.innerHTML = '';
    const count = configuredFolders.length;
    foldersCountBadge.textContent = `${count} configured`;

    if (count === 0) {
      const emptyNote = document.createElement('p');
      emptyNote.className = 'empty-folders-text';
      emptyNote.textContent = 'No folders configured yet. Add one below.';
      configuredFoldersList.appendChild(emptyNote);
      return;
    }

    for (const folder of configuredFolders) {
      const tag = document.createElement('div');
      tag.className = 'folder-tag';

      const icon = document.createElement('span');
      icon.className = 'folder-icon';
      icon.textContent = '📁';

      const name = document.createElement('span');
      name.className = 'folder-tag-name';
      name.textContent = folder;
      name.title = folder;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'folder-remove-btn';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = `Remove ${folder}`;
      removeBtn.type = 'button';
      removeBtn.addEventListener('click', () => {
        handleRemoveFolder(folder);
      });

      tag.appendChild(icon);
      tag.appendChild(name);
      tag.appendChild(removeBtn);
      configuredFoldersList.appendChild(tag);
    }
  }

  /**
   * Handle adding a destination folder
   */
  function handleAddFolder(folderPath) {
    const error = validateFolderPathInput(folderPath);
    if (error) {
      if (folderValidationMsg) {
        folderValidationMsg.textContent = error;
        folderValidationMsg.classList.remove('hidden');
      }
      return;
    }

    if (folderValidationMsg) {
      folderValidationMsg.classList.add('hidden');
    }

    chrome.runtime.sendMessage(
      {
        action: AceConstants.MESSAGES.ADD_DESTINATION_FOLDER,
        folderPath: folderPath
      },
      (response) => {
        if (response && response.success) {
          showToast(`Added folder: ${folderPath}`);
          if (newFolderInput) newFolderInput.value = '';
          configuredFolders = response.folders || [];
          renderDestinationFoldersList();
        } else {
          const err = (response && response.error) || 'Failed to add folder.';
          showToast(err, true);
          if (folderValidationMsg) {
            folderValidationMsg.textContent = err;
            folderValidationMsg.classList.remove('hidden');
          }
        }
      }
    );
  }

  /**
   * Handle removing a destination folder
   */
  function handleRemoveFolder(folderPath) {
    chrome.runtime.sendMessage(
      {
        action: AceConstants.MESSAGES.REMOVE_DESTINATION_FOLDER,
        folderPath: folderPath
      },
      (response) => {
        if (response && response.success) {
          showToast(`Removed folder: ${folderPath}`);
          configuredFolders = response.folders || [];
          renderDestinationFoldersList();
        } else {
          showToast('Failed to remove folder.', true);
        }
      }
    );
  }

  /**
   * Fetch existing directories in the repository and populate dropdown
   */
  function loadExistingDirectories() {
    if (!existingDirectoriesGroup || !existingDirectoriesDropdown) return;

    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_REPO_DIRECTORIES }, (response) => {
      if (response && response.success && Array.isArray(response.directories) && response.directories.length > 0) {
        existingDirectoriesDropdown.innerHTML = '<option value="">Choose existing folder</option>';

        for (const dir of response.directories) {
          const opt = document.createElement('option');
          opt.value = dir;
          opt.textContent = `📁 ${dir}`;
          existingDirectoriesDropdown.appendChild(opt);
        }

        existingDirectoriesGroup.classList.remove('hidden');
      } else {
        existingDirectoriesGroup.classList.add('hidden');
      }
    });
  }

  if (addFolderBtn && newFolderInput) {
    addFolderBtn.addEventListener('click', () => {
      handleAddFolder(newFolderInput.value);
    });

    newFolderInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddFolder(newFolderInput.value);
      }
    });

    newFolderInput.addEventListener('input', () => {
      if (folderValidationMsg) {
        folderValidationMsg.classList.add('hidden');
      }
    });
  }

  if (existingDirectoriesDropdown && addExistingDirBtn) {
    existingDirectoriesDropdown.addEventListener('change', () => {
      addExistingDirBtn.disabled = !existingDirectoriesDropdown.value;
    });

    addExistingDirBtn.addEventListener('click', () => {
      const selectedDir = existingDirectoriesDropdown.value;
      if (selectedDir) {
        handleAddFolder(selectedDir);
      }
    });
  }

  /**
   * =========================================================================
   * STATISTICS DASHBOARD
   * =========================================================================
   */

  /**
   * Generate an encouraging personalized progress greeting based on problems solved
   * @param {number} total 
   * @returns {string}
   */
  function generateProgressGreeting(total) {
    if (total === 0) {
      return "Welcome! Start solving on LeetCode to build your repository.";
    }
    if (total === 1) {
      return "Great start! You've solved your first problem. Keep going!";
    }
    if (total < 10) {
      return `You've solved ${total} problems so far. Strong momentum!`;
    }
    if (total < 25) {
      return `You've solved ${total} problems so far. Consistency is key!`;
    }
    if (total < 50) {
      return `You've solved ${total} problems so far. Keep pushing forward!`;
    }
    if (total < 100) {
      return `Impressive work! ${total} problems solved. Milestone ahead!`;
    }
    return `Mastery in action! ${total} problems solved. Outstanding!`;
  }

  /**
   * Load and render the statistics dashboard
   */
  function loadStatsDashboard() {
    chrome.storage.local.get(
      [AceConstants.STORAGE_KEYS.STATS, AceConstants.STORAGE_KEYS.UPLOAD_HISTORY],
      (result) => {
        let stats = result[AceConstants.STORAGE_KEYS.STATS];
        const history = Array.isArray(result[AceConstants.STORAGE_KEYS.UPLOAD_HISTORY])
          ? result[AceConstants.STORAGE_KEYS.UPLOAD_HISTORY]
          : [];

        if (!stats) {
          // Compute from history if stats key not present
          const total = history.length;
          const easy = history.filter((p) => (p.difficulty || '').toLowerCase() === 'easy').length;
          const medium = history.filter((p) => (p.difficulty || '').toLowerCase() === 'medium').length;
          const hard = history.filter((p) => (p.difficulty || '').toLowerCase() === 'hard').length;
          stats = { total, easy, medium, hard };
        }

        renderStatsDashboard(stats);
      }
    );
  }

  /**
   * Render statistics values and encouraging greeting in popup
   * @param {{ total: number, easy: number, medium: number, hard: number }} stats 
   */
  function renderStatsDashboard(stats) {
    const total = stats && typeof stats.total === 'number' ? stats.total : 0;
    const easy = stats && typeof stats.easy === 'number' ? stats.easy : 0;
    const medium = stats && typeof stats.medium === 'number' ? stats.medium : 0;
    const hard = stats && typeof stats.hard === 'number' ? stats.hard : 0;

    if (statTotalSolved) statTotalSolved.textContent = String(total);
    if (statEasySolved) statEasySolved.textContent = String(easy);
    if (statMediumSolved) statMediumSolved.textContent = String(medium);
    if (statHardSolved) statHardSolved.textContent = String(hard);

    const taskSolvedCount = document.getElementById('taskSolvedCount');
    if (taskSolvedCount) taskSolvedCount.textContent = String(total);

    if (statsGreetingText) {
      statsGreetingText.textContent = generateProgressGreeting(total);
    }
  }

  // Reset Statistics Button Listener
  if (resetStatsBtn) {
    resetStatsBtn.addEventListener('click', () => {
      const confirmed = window.confirm(
        'Reset problem solving statistics?\n\n' +
        'This will reset your solved counts to 0 and clear AceLC entries from your GitHub repository README dashboard. Your uploaded solution files will remain safe.'
      );
      if (!confirmed) return;

      resetStatsBtn.disabled = true;
      resetStatsBtn.textContent = 'Resetting...';

      chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.RESET_STATS }, (response) => {
        resetStatsBtn.disabled = false;
        resetStatsBtn.textContent = 'Reset Statistics';

        if (response && response.success) {
          showFeedback('Statistics and repository dashboard reset successfully.', 'success');
          loadStatsDashboard();
        } else {
          const err = response && response.error ? response.error : 'Failed to reset repository dashboard.';
          showFeedback(err, 'error');
          loadStatsDashboard();
        }
      });
    });
  }

  /**
   * =========================================================================
   * DESTINATION SELECTION INTERFACE (PHASE 6)
   * =========================================================================
   */

  /**
   * Load and render the pending submissions destination selection queue
   */
  function loadPendingQueue() {
    if (!destSelectionCard) return;

    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_PENDING_QUEUE }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        destSelectionCard.classList.add('hidden');
        return;
      }

      pendingSubmissionsQueue = Array.isArray(response.queue) ? response.queue : [];
      const repository = response.repository || null;
      const folders = Array.isArray(response.folders) ? response.folders : [];

      if (pendingSubmissionsQueue.length === 0) {
        destSelectionCard.classList.add('hidden');
        return;
      }

      if (currentQueueIndex >= pendingSubmissionsQueue.length) {
        currentQueueIndex = Math.max(0, pendingSubmissionsQueue.length - 1);
      }

      renderDestinationSelectionCard(repository, folders);
    });
  }

  /**
   * Render the destination selection card for the active queued submission
   */
  function renderDestinationSelectionCard(repository, folders) {
    if (pendingSubmissionsQueue.length === 0) {
      destSelectionCard.classList.add('hidden');
      return;
    }

    destSelectionCard.classList.remove('hidden');

    const item = pendingSubmissionsQueue[currentQueueIndex];
    if (!item) return;

    // 1. Problem Information
    const numDisplay = item.problemNumber ? `#${item.problemNumber} ` : '';
    destProblemTitle.textContent = `${numDisplay}${item.problemTitle}`;
    destProblemTitle.title = `${numDisplay}${item.problemTitle}`;

    const diffDisplay = item.difficulty ? ` [${item.difficulty}]` : '';
    destLanguageBadge.textContent = (item.language || 'Java') + diffDisplay;

    if (item.runtime) {
      destRuntimeBadge.textContent = `⚡ ${item.runtime}`;
      destRuntimeBadge.classList.remove('hidden');
    } else {
      destRuntimeBadge.classList.add('hidden');
    }

    if (item.memory) {
      destMemoryBadge.textContent = `💾 ${item.memory}`;
      destMemoryBadge.classList.remove('hidden');
    } else {
      destMemoryBadge.classList.add('hidden');
    }

    // 2. Destination Repository
    destRepoName.textContent = repository ? repository.fullName : 'No repository selected';

    // 3. Destination Folders Checklist
    destFoldersChecklist.innerHTML = '';
    destValidationMsg.classList.add('hidden');

    if (folders.length === 0) {
      destSelectAllBtn.style.display = 'none';
      const emptyNote = document.createElement('div');
      emptyNote.className = 'empty-folders-text';
      emptyNote.textContent = 'No folders configured yet. Add folders in the section below.';
      destFoldersChecklist.appendChild(emptyNote);
    } else {
      destSelectAllBtn.style.display = 'block';
      destSelectAllBtn.textContent = 'Deselect All';

      for (const folder of folders) {
        const row = document.createElement('label');
        row.className = 'dest-folder-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = folder;
        cb.checked = true;

        const name = document.createElement('span');
        name.textContent = `📁 ${folder}`;

        row.appendChild(cb);
        row.appendChild(name);
        destFoldersChecklist.appendChild(row);
      }
    }

    // 4. Queue Navigation (if multiple pending submissions)
    if (pendingSubmissionsQueue.length > 1) {
      destQueueNav.classList.remove('hidden');
      destQueueBadge.classList.remove('hidden');
      destQueueBadge.textContent = `${currentQueueIndex + 1} of ${pendingSubmissionsQueue.length}`;
      destQueueNavText.textContent = `Submission ${currentQueueIndex + 1} of ${pendingSubmissionsQueue.length}`;

      destPrevBtn.disabled = currentQueueIndex === 0;
      destNextBtn.disabled = currentQueueIndex === pendingSubmissionsQueue.length - 1;
    } else {
      destQueueNav.classList.add('hidden');
      destQueueBadge.classList.add('hidden');
    }
  }

  // Folder Checklist Toggle All
  if (destSelectAllBtn) {
    let allSelected = true;
    destSelectAllBtn.addEventListener('click', () => {
      const checkboxes = destFoldersChecklist.querySelectorAll('input[type="checkbox"]');
      allSelected = !allSelected;
      checkboxes.forEach((cb) => (cb.checked = allSelected));
      destSelectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
      if (allSelected) destValidationMsg.classList.add('hidden');
    });
  }

  // Upload Solution Confirmation Button
  if (destConfirmBtn) {
    destConfirmBtn.addEventListener('click', () => {
      if (pendingSubmissionsQueue.length === 0) return;
      const item = pendingSubmissionsQueue[currentQueueIndex];
      if (!item) return;

      const checkedBoxes = destFoldersChecklist.querySelectorAll('input[type="checkbox"]:checked');
      const selectedFolders = Array.from(checkedBoxes).map((cb) => cb.value);

      // Validate at least one destination folder is selected
      if (selectedFolders.length === 0) {
        destValidationMsg.textContent = 'Please select at least one destination folder.';
        destValidationMsg.classList.remove('hidden');
        return;
      }

      destValidationMsg.classList.add('hidden');
      destConfirmBtn.disabled = true;
      destConfirmBtn.textContent = 'Confirming...';

      // Step 1: Confirm destination selection (Phase 6)
      chrome.runtime.sendMessage(
        {
          action: AceConstants.MESSAGES.CONFIRM_DESTINATION_SELECTION,
          payload: {
            submissionUid: item.uid,
            selectedFolders: selectedFolders
          }
        },
        (confirmResponse) => {
          if (chrome.runtime.lastError || !confirmResponse || !confirmResponse.success) {
            destConfirmBtn.disabled = false;
            destConfirmBtn.textContent = 'Upload Solution';
            const err = (confirmResponse && confirmResponse.error) || 'Failed to confirm destination selection.';
            showToast(err, true);
            destValidationMsg.textContent = err;
            destValidationMsg.classList.remove('hidden');
            return;
          }

          const confirmedRecord = confirmResponse.confirmedSubmission;
          if (!confirmedRecord) {
            destConfirmBtn.disabled = false;
            destConfirmBtn.textContent = 'Upload Solution';
            showToast('Confirmed but could not start upload.', true);
            loadPendingQueue();
            return;
          }

          // Step 2: Trigger upload (Phase 7)
          destConfirmBtn.textContent = 'Uploading...';
          startUpload(confirmedRecord.uid, {});
        }
      );
    });
  }

  /**
   * Initiate a GitHub solution upload for a confirmed submission.
   * Handles overwrite confirmation inline when a file already exists.
   * @param {string} uid
   * @param {object} overwriteDecisions  { folderPath: 'overwrite'|'skip' }
   */
  function startUpload(uid, overwriteDecisions) {
    destConfirmBtn.disabled = true;
    destConfirmBtn.textContent = 'Uploading...';

    chrome.runtime.sendMessage(
      {
        action: AceConstants.MESSAGES.UPLOAD_SOLUTION,
        payload: {
          submissionUid: uid,
          overwriteDecisions: overwriteDecisions || {}
        }
      },
      (response) => {
        destConfirmBtn.disabled = false;
        destConfirmBtn.textContent = 'Upload Solution';

        if (chrome.runtime.lastError || !response) {
          showToast('Upload failed: could not reach background worker.', true);
          loadPendingQueue();
          return;
        }

        // Handle overwrite confirmation needed for one or more folders
        if (response.needsOverwriteConfirmation && Array.isArray(response.results)) {
          const conflicting = response.results.filter((r) => r.needsOverwriteConfirmation);
          const succeededSoFar = response.results.filter((r) => r.success && !r.needsOverwriteConfirmation);

          // Show inline overwrite prompt for each conflicting folder
          showOverwritePrompt(uid, conflicting, succeededSoFar, overwriteDecisions);
          return;
        }

        if (!response.success && !response.results) {
          showToast(response.error || 'Upload failed.', true);
          loadPendingQueue();
          return;
        }

        // Render upload results
        renderUploadResults(response);
        loadPendingQueue();
      }
    );
  }

  /**
   * Show inline overwrite confirmation prompt for conflicting files.
   * Resumes the upload once the user decides for all conflicts.
   * @param {string} uid
   * @param {Array} conflicting  — results with needsOverwriteConfirmation
   * @param {Array} succeeded    — results that already succeeded
   * @param {object} existingDecisions
   */
  function showOverwritePrompt(uid, conflicting, succeeded, existingDecisions) {
    if (!destValidationMsg) return;

    // Build an inline decision UI inside destValidationMsg area
    destValidationMsg.classList.remove('hidden');

    const decisions = { ...existingDecisions };
    let resolvedCount = 0;

    // Create overwrite prompt container
    const promptContainer = document.createElement('div');
    promptContainer.className = 'overwrite-prompt';

    const intro = document.createElement('p');
    intro.className = 'overwrite-intro';
    intro.textContent = `${conflicting.length} file(s) already exist in GitHub:`;
    promptContainer.appendChild(intro);

    for (const item of conflicting) {
      const row = document.createElement('div');
      row.className = 'overwrite-row';

      const pathLabel = document.createElement('span');
      pathLabel.className = 'overwrite-path';
      pathLabel.textContent = item.filePath;

      const overwriteBtn = document.createElement('button');
      overwriteBtn.className = 'overwrite-btn-action overwrite-btn-yes';
      overwriteBtn.textContent = 'Overwrite';
      overwriteBtn.dataset.folder = item.folder;
      overwriteBtn.dataset.decision = 'overwrite';

      const skipBtn = document.createElement('button');
      skipBtn.className = 'overwrite-btn-action overwrite-btn-skip';
      skipBtn.textContent = 'Skip';
      skipBtn.dataset.folder = item.folder;
      skipBtn.dataset.decision = 'skip';

      function handleDecision(folder, decision) {
        decisions[folder] = decision;
        overwriteBtn.disabled = true;
        skipBtn.disabled = true;
        row.classList.add('overwrite-decided');
        pathLabel.textContent = `${item.filePath} → ${decision === 'overwrite' ? '✏️ Overwrite' : '⏭️ Skip'}`;
        resolvedCount += 1;

        // Once all conflicts are resolved, re-trigger upload
        if (resolvedCount === conflicting.length) {
          destValidationMsg.innerHTML = '';
          destValidationMsg.classList.add('hidden');
          startUpload(uid, decisions);
        }
      }

      overwriteBtn.addEventListener('click', () => handleDecision(item.folder, 'overwrite'));
      skipBtn.addEventListener('click', () => handleDecision(item.folder, 'skip'));

      row.appendChild(pathLabel);
      row.appendChild(overwriteBtn);
      row.appendChild(skipBtn);
      promptContainer.appendChild(row);
    }

    // Show already-succeeded results as well
    if (succeeded.length > 0) {
      const successNote = document.createElement('p');
      successNote.className = 'overwrite-success-note';
      successNote.textContent = `${succeeded.length} file(s) uploaded successfully so far.`;
      promptContainer.appendChild(successNote);
    }

    destValidationMsg.innerHTML = '';
    destValidationMsg.appendChild(promptContainer);
  }

  /**
   * Render a summary of upload results in the destination card.
   * @param {object} response  — from UPLOAD_SOLUTION
   */
  function renderUploadResults(response) {
    if (!destValidationMsg || !response || !Array.isArray(response.results)) return;

    const results = response.results;
    const created = results.filter((r) => r.success && !r.skipped && !r.overwritten);
    const overwritten = results.filter((r) => r.success && r.overwritten);
    const skipped = results.filter((r) => r.success && r.skipped);
    const failed = results.filter((r) => !r.success && !r.needsOverwriteConfirmation);

    const summaryContainer = document.createElement('div');
    summaryContainer.className = 'upload-summary';

    if (created.length > 0 || overwritten.length > 0) {
      const successHeader = document.createElement('div');
      successHeader.className = 'upload-summary-success';
      successHeader.textContent = `✅ Upload successful — ${response.filename || 'file'}`;
      summaryContainer.appendChild(successHeader);

      for (const r of [...created, ...overwritten]) {
        const row = document.createElement('div');
        row.className = 'upload-result-row';
        const icon = r.overwritten ? '✏️' : '📄';
        const link = document.createElement('a');
        link.href = r.url || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `${icon} ${r.filePath}`;
        link.className = 'upload-result-link';
        row.appendChild(link);
        summaryContainer.appendChild(row);
      }
    }

    if (skipped.length > 0) {
      for (const r of skipped) {
        const row = document.createElement('div');
        row.className = 'upload-result-row upload-result-skipped';
        row.textContent = `⏭️ Skipped (already exists): ${r.filePath}`;
        summaryContainer.appendChild(row);
      }
    }

    if (failed.length > 0) {
      for (const r of failed) {
        const row = document.createElement('div');
        row.className = 'upload-result-row upload-result-failed';
        row.textContent = `❌ Failed: ${r.filePath} — ${r.error || 'Unknown error'}`;
        summaryContainer.appendChild(row);
      }
    }

    destValidationMsg.innerHTML = '';
    destValidationMsg.appendChild(summaryContainer);
    destValidationMsg.classList.remove('hidden');

    // Toast summary
    if (created.length + overwritten.length > 0 && failed.length === 0) {
      showToast(`Solution uploaded successfully!`);
    } else if (created.length + overwritten.length > 0 && failed.length > 0) {
      showToast(`Partial upload: ${created.length + overwritten.length} succeeded, ${failed.length} failed.`, true);
    } else if (failed.length > 0) {
      showToast(`Upload failed for all destinations.`, true);
    } else if (skipped.length > 0) {
      showToast(`Skipped ${skipped.length} file(s) — already on GitHub.`);
    }
  }

  // Cancel Pending Submission Button
  if (destCancelBtn) {
    destCancelBtn.addEventListener('click', () => {
      if (pendingSubmissionsQueue.length === 0) return;
      const item = pendingSubmissionsQueue[currentQueueIndex];
      if (!item) return;

      chrome.runtime.sendMessage(
        {
          action: AceConstants.MESSAGES.CANCEL_DESTINATION_SELECTION,
          payload: {
            submissionUid: item.uid
          }
        },
        (response) => {
          showToast('Submission cancelled.');
          loadPendingQueue();
        }
      );
    });
  }

  // Queue Pagination Prev Button
  if (destPrevBtn) {
    destPrevBtn.addEventListener('click', () => {
      if (currentQueueIndex > 0) {
        currentQueueIndex -= 1;
        loadPendingQueue();
      }
    });
  }

  // Queue Pagination Next Button
  if (destNextBtn) {
    destNextBtn.addEventListener('click', () => {
      if (currentQueueIndex < pendingSubmissionsQueue.length - 1) {
        currentQueueIndex += 1;
        loadPendingQueue();
      }
    });
  }

  /**
   * =========================================================================
   * AUTHENTICATION & GLOBAL HANDLERS
   * =========================================================================
   */

  async function refreshAuthStatus() {
    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_AUTH_STATUS }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        setViewState(AceConstants.AUTH_STATUS.NOT_CONNECTED);
        return;
      }

      if (response.clientId && clientIdInput) {
        clientIdInput.value = response.clientId;
      }

      if (response.status === AceConstants.AUTH_STATUS.CONNECTED && response.user) {
        renderConnected(response.user);
      } else if (response.status === AceConstants.AUTH_STATUS.WAITING_FOR_AUTH && response.authState) {
        renderWaitingAuth();
      } else if (response.status === AceConstants.AUTH_STATUS.FAILED && response.authState) {
        renderAuthFailed(response.authState.error);
      } else {
        setViewState(AceConstants.AUTH_STATUS.NOT_CONNECTED);
      }
    });
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      connectBtn.disabled = true;
      connectBtn.textContent = 'Connecting...';
      setViewState(AceConstants.AUTH_STATUS.WAITING_FOR_AUTH);

      // Generate cryptographically random state parameter
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const state = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

      const clientId = AceConstants.GITHUB.DEFAULT_CLIENT_ID;
      const redirectUri = AceConstants.GITHUB.REDIRECT_URI || 'https://github.com/';
      const authUrl = `${AceConstants.GITHUB.AUTHORIZE_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${AceConstants.GITHUB.SCOPES}&state=${state}`;

      // Notify background to save pending auth state
      chrome.runtime.sendMessage({
        action: AceConstants.MESSAGES.START_AUTH,
        state: state
      });

      // Directly open the GitHub authorization tab in the active browser window
      chrome.tabs.create({ url: authUrl, active: true }, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          showToast('Failed to open GitHub authorization tab.', true);
          setViewState(AceConstants.AUTH_STATUS.NOT_CONNECTED);
          connectBtn.disabled = false;
          connectBtn.textContent = 'Connect +';
        }
      });
    });
  }

  if (cancelAuthBtn) {
    cancelAuthBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.CANCEL_AUTH }, () => {
        setViewState(AceConstants.AUTH_STATUS.NOT_CONNECTED);
        showToast('Authorization cancelled.');
      });
    });
  }

  if (retryAuthBtn) {
    retryAuthBtn.addEventListener('click', () => {
      setViewState(AceConstants.AUTH_STATUS.NOT_CONNECTED);
    });
  }

  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.DISCONNECT_AUTH }, (response) => {
        if (response && response.success) {
          showToast('Disconnected from GitHub.');
          setViewState(AceConstants.AUTH_STATUS.NOT_CONNECTED);
        }
      });
    });
  }

  if (openOptionsBtn) {
    openOptionsBtn.addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('Settings/options.html'));
      }
    });
  }

  const headerCloseBtn = document.getElementById('headerCloseBtn');
  if (headerCloseBtn) {
    headerCloseBtn.addEventListener('click', () => {
      window.close();
    });
  }

  const toggleRepoConfigBtn = document.getElementById('toggleRepoConfigBtn');
  if (toggleRepoConfigBtn) {
    toggleRepoConfigBtn.addEventListener('click', () => {
      const drawer = document.querySelector('.repo-drawer');
      if (drawer) {
        drawer.classList.toggle('hidden');
        const isExp = !drawer.classList.contains('hidden');
        const spanText = toggleRepoConfigBtn.querySelector('span');
        if (spanText) {
          spanText.textContent = isExp ? 'Close' : 'Configure +';
        }
      }
    });
  }

  /**
   * Listen for storage changes to update UI in real-time
   */
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes[AceConstants.STORAGE_KEYS.AUTH_STATE] || changes[AceConstants.STORAGE_KEYS.USER_INFO]) {
      refreshAuthStatus();
    }

    if (changes[AceConstants.STORAGE_KEYS.SELECTED_REPO]) {
      loadSelectedRepository();
    }

    if (changes[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]) {
      loadDestinationFolders();
      loadPendingQueue();
    }

    if (changes[AceConstants.STORAGE_KEYS.PENDING_SUBMISSION_QUEUE]) {
      loadPendingQueue();
    }

    if (changes[AceConstants.STORAGE_KEYS.STATS] || changes[AceConstants.STORAGE_KEYS.UPLOAD_HISTORY]) {
      loadStatsDashboard();
    }
  });

  // Initial status load
  refreshAuthStatus();
  loadStatsDashboard();
  loadPendingQueue();
});
