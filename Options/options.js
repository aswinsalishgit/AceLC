/**
 * AceLC - Options Script
 * Manages configuration, GitHub connection status, and repository selection.
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

  let cachedRepos = [];
  let currentRepo = null;

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

        // Load repositories for selection
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
      } else {
        currentRepo = null;
        optionsRepoActiveRow.classList.add('hidden');
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
            showToast('Repository destination updated!');
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
      loadSettings();
    }
  });

  loadSettings();
});
