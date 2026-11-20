/**
 * AceLC - Options Script
 * Manages configuration and GitHub connection status in options view.
 */

document.addEventListener('DOMContentLoaded', () => {
  const accountDot = document.getElementById('accountDot');
  const accountStatusText = document.getElementById('accountStatusText');
  const accountDetails = document.getElementById('accountDetails');
  const optionsDisconnectBtn = document.getElementById('optionsDisconnectBtn');
  const optionsClientIdInput = document.getElementById('optionsClientIdInput');
  const saveClientIdBtn = document.getElementById('saveClientIdBtn');
  const optionsToast = document.getElementById('optionsToast');

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
      } else {
        accountDot.className = 'status-dot dot-neutral';
        accountStatusText.textContent = 'Not Connected';
        accountDetails.textContent = 'Connect your GitHub account through the AceLC popup using OAuth Device Flow.';
        optionsDisconnectBtn.classList.add('hidden');
      }
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

  // Real-time update if storage changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      loadSettings();
    }
  });

  loadSettings();
});
