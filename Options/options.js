/**
 * AceLC - Options Script
 * Manages configuration, GitHub connection status, repository selection,
 * and destination folder management.
 */

document.addEventListener('DOMContentLoaded', () => {
  const accountDot = document.getElementById('accountDot');
  const accountStatusText = document.getElementById('accountStatusText');
  const accountDetails = document.getElementById('accountDetails');
  const optionsDisconnectBtn = document.getElementById('optionsDisconnectBtn');
  const optionsClientIdInput = document.getElementById('optionsClientIdInput');
  const saveClientIdBtn = document.getElementById('saveClientIdBtn');
  const optionsToast = document.getElementById('optionsToast');

  // Repo elements
  const optionsRepoActiveRow = document.getElementById('optionsRepoActiveRow');
  const optionsRepoBadge = document.getElementById('optionsRepoBadge');
  const optionsRepoLink = document.getElementById('optionsRepoLink');
  const optionsRepoDropdown = document.getElementById('optionsRepoDropdown');
  const optionsSaveRepoBtn = document.getElementById('optionsSaveRepoBtn');

  // Folders elements (Phase 4)
  const optionsFoldersSection = document.getElementById('optionsFoldersSection');
  const optionsFoldersCount = document.getElementById('optionsFoldersCount');
  const optionsFoldersList = document.getElementById('optionsFoldersList');
  const optionsNewFolderInput = document.getElementById('optionsNewFolderInput');
  const optionsAddFolderBtn = document.getElementById('optionsAddFolderBtn');
  const optionsExistingDirGroup = document.getElementById('optionsExistingDirGroup');
  const optionsExistingDirDropdown = document.getElementById('optionsExistingDirDropdown');
  const optionsAddExistingDirBtn = document.getElementById('optionsAddExistingDirBtn');

  let cachedRepos = [];
  let currentRepo = null;
  let configuredFolders = [];

  function showToast(message) {
    if (!optionsToast) return;
    optionsToast.textContent = message;
    optionsToast.classList.remove('hidden');
    setTimeout(() => {
      optionsToast.classList.add('hidden');
    }, 3000);
  }

  function loadSettings() {
    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_AUTH_STATUS }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        return;
      }

      if (optionsClientIdInput && response.clientId) {
        optionsClientIdInput.value = response.clientId;
      }

      if (response.status === AceConstants.AUTH_STATUS.CONNECTED && response.user) {
        accountDot.className = 'status-dot dot-success';
        accountStatusText.textContent = `Connected as @${response.user.login}`;
        accountDetails.textContent = `Authenticated user: ${response.user.name || response.user.login} (${response.user.login})`;
        optionsDisconnectBtn.classList.remove('hidden');

        loadSelectedRepo();
        loadRepoList();
      } else {
        accountDot.className = 'status-dot dot-neutral';
        accountStatusText.textContent = 'Not Connected';
        accountDetails.textContent = 'Connect your GitHub account through the AceLC popup using OAuth Device Flow.';
        optionsDisconnectBtn.classList.add('hidden');
        optionsRepoActiveRow.classList.add('hidden');
        optionsRepoDropdown.innerHTML = '<option value="">-- Connect GitHub to load repositories --</option>';
        optionsSaveRepoBtn.disabled = true;
        if (optionsFoldersSection) optionsFoldersSection.classList.add('hidden');
      }
    });
  }

  function loadSelectedRepo() {
    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_SELECTED_REPO }, (response) => {
      if (response && response.success && response.repository) {
        currentRepo = response.repository;
        optionsRepoActiveRow.classList.remove('hidden');
        optionsRepoLink.textContent = currentRepo.fullName;
        optionsRepoLink.href = currentRepo.htmlUrl || `https://github.com/${currentRepo.fullName}`;

        const isPrivate = Boolean(currentRepo.isPrivate);
        optionsRepoBadge.textContent = isPrivate ? 'Private' : 'Public';
        optionsRepoBadge.className = isPrivate ? 'repo-badge badge-private' : 'repo-badge badge-public';

        if (optionsFoldersSection) {
          optionsFoldersSection.classList.remove('hidden');
          loadDestinationFolders();
          loadExistingDirectories();
        }
      } else {
        currentRepo = null;
        optionsRepoActiveRow.classList.add('hidden');
        if (optionsFoldersSection) optionsFoldersSection.classList.add('hidden');
      }
    });
  }

  function loadRepoList() {
    optionsRepoDropdown.innerHTML = '<option value="">-- Loading repositories... --</option>';
    optionsSaveRepoBtn.disabled = true;

    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_REPOSITORIES }, (response) => {
      if (response && response.success && Array.isArray(response.repositories)) {
        cachedRepos = response.repositories;
        optionsRepoDropdown.innerHTML = '<option value="">-- Choose a repository --</option>';

        for (const repo of cachedRepos) {
          const opt = document.createElement('option');
          opt.value = repo.fullName;
          opt.textContent = `${repo.name} (${repo.isPrivate ? 'Private' : 'Public'})`;

          if (currentRepo && currentRepo.fullName === repo.fullName) {
            opt.selected = true;
            optionsSaveRepoBtn.disabled = false;
          }

          optionsRepoDropdown.appendChild(opt);
        }
      } else {
        optionsRepoDropdown.innerHTML = '<option value="">-- Error loading repositories --</option>';
      }
    });
  }

  /**
   * Destination Folders Management (Phase 4)
   */
  function loadDestinationFolders() {
    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_DESTINATION_FOLDERS }, (response) => {
      if (response && response.success && Array.isArray(response.folders)) {
        configuredFolders = response.folders;
      } else {
        configuredFolders = [];
      }
      renderFoldersList();
    });
  }

  function renderFoldersList() {
    if (!optionsFoldersList || !optionsFoldersCount) return;
    optionsFoldersList.innerHTML = '';
    const count = configuredFolders.length;
    optionsFoldersCount.textContent = `${count} configured`;

    if (count === 0) {
      optionsFoldersList.innerHTML = '<p class="text-muted">No folders configured for this repository yet.</p>';
      return;
    }

    for (const folder of configuredFolders) {
      const tag = document.createElement('div');
      tag.className = 'folder-tag';

      const label = document.createElement('span');
      label.textContent = `📁 ${folder}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'folder-remove-btn';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = `Remove ${folder}`;
      removeBtn.type = 'button';
      removeBtn.addEventListener('click', () => {
        handleRemoveFolder(folder);
      });

      tag.appendChild(label);
      tag.appendChild(removeBtn);
      optionsFoldersList.appendChild(tag);
    }
  }

  function handleAddFolder(folderPath) {
    if (!folderPath || !folderPath.trim()) return;

    chrome.runtime.sendMessage(
      {
        action: AceConstants.MESSAGES.ADD_DESTINATION_FOLDER,
        folderPath: folderPath.trim()
      },
      (response) => {
        if (response && response.success) {
          showToast(`Added folder: ${folderPath}`);
          if (optionsNewFolderInput) optionsNewFolderInput.value = '';
          configuredFolders = response.folders || [];
          renderFoldersList();
        } else {
          showToast((response && response.error) || 'Failed to add folder.');
        }
      }
    );
  }

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
          renderFoldersList();
        } else {
          showToast('Failed to remove folder.');
        }
      }
    );
  }

  function loadExistingDirectories() {
    if (!optionsExistingDirGroup || !optionsExistingDirDropdown) return;

    chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.GET_REPO_DIRECTORIES }, (response) => {
      if (response && response.success && Array.isArray(response.directories) && response.directories.length > 0) {
        optionsExistingDirDropdown.innerHTML = '<option value="">-- Choose existing folder --</option>';

        for (const dir of response.directories) {
          const opt = document.createElement('option');
          opt.value = dir;
          opt.textContent = `📁 ${dir}`;
          optionsExistingDirDropdown.appendChild(opt);
        }

        optionsExistingDirGroup.classList.remove('hidden');
      } else {
        optionsExistingDirGroup.classList.add('hidden');
      }
    });
  }

  if (optionsAddFolderBtn && optionsNewFolderInput) {
    optionsAddFolderBtn.addEventListener('click', () => {
      handleAddFolder(optionsNewFolderInput.value);
    });

    optionsNewFolderInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddFolder(optionsNewFolderInput.value);
      }
    });
  }

  if (optionsExistingDirDropdown && optionsAddExistingDirBtn) {
    optionsExistingDirDropdown.addEventListener('change', () => {
      optionsAddExistingDirBtn.disabled = !optionsExistingDirDropdown.value;
    });

    optionsAddExistingDirBtn.addEventListener('click', () => {
      const selected = optionsExistingDirDropdown.value;
      if (selected) {
        handleAddFolder(selected);
      }
    });
  }

  if (optionsRepoDropdown) {
    optionsRepoDropdown.addEventListener('change', () => {
      optionsSaveRepoBtn.disabled = !optionsRepoDropdown.value;
    });
  }

  if (optionsSaveRepoBtn) {
    optionsSaveRepoBtn.addEventListener('click', () => {
      const selectedFullName = optionsRepoDropdown.value;
      const found = cachedRepos.find((r) => r.fullName === selectedFullName);
      if (!found) return;

      chrome.runtime.sendMessage(
        {
          action: AceConstants.MESSAGES.SELECT_REPOSITORY,
          repository: found
        },
        (response) => {
          if (response && response.success) {
            showToast('Repository destination updated! (Folders reset)');
            loadSelectedRepo();
          }
        }
      );
    });
  }

  if (saveClientIdBtn && optionsClientIdInput) {
    saveClientIdBtn.addEventListener('click', async () => {
      const clientId = optionsClientIdInput.value.trim();
      await chrome.storage.local.set({
        [AceConstants.STORAGE_KEYS.CLIENT_ID]: clientId
      });
      showToast('OAuth Client ID saved successfully.');
    });
  }

  if (optionsDisconnectBtn) {
    optionsDisconnectBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.DISCONNECT_AUTH }, (response) => {
        if (response && response.success) {
          showToast('Disconnected from GitHub.');
          loadSettings();
        }
      });
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes[AceConstants.STORAGE_KEYS.SELECTED_REPO] || changes[AceConstants.STORAGE_KEYS.DESTINATION_FOLDERS]) {
        loadSelectedRepo();
      }
    }
  });

  loadSettings();
});
