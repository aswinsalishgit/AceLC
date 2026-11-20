/**
 * AceLC - Popup Script
 * Coordinates GitHub authentication UI states and user actions.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - State Containers
  const stateNotConnected = document.getElementById('stateNotConnected');
  const stateWaitingAuth = document.getElementById('stateWaitingAuth');
  const stateConnected = document.getElementById('stateConnected');
  const stateAuthFailed = document.getElementById('stateAuthFailed');

  // DOM Elements - Inputs & Controls
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
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const userHandle = document.getElementById('userHandle');
  const authErrorMessage = document.getElementById('authErrorMessage');
  const feedbackToast = document.getElementById('feedbackToast');

  let activeVerificationUri = AceConstants.GITHUB.VERIFICATION_URL;
  let activeUserCode = '';

  /**
   * Show feedback message banner
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
   * Render Connected State
   */
  function renderConnected(user) {
    if (!user) return;
    userName.textContent = user.name || user.login;
    userHandle.textContent = `@${user.login}`;
    userHandle.href = user.htmlUrl || `https://github.com/${user.login}`;

    if (user.avatarUrl) {
      userAvatar.src = user.avatarUrl;
      userAvatar.alt = `${user.login}'s Avatar`;
    } else {
      userAvatar.src = '';
      userAvatar.alt = 'User Avatar';
    }

    setViewState(AceConstants.AUTH_STATUS.CONNECTED);
  }

  /**
   * Render Waiting for Authorization State
   */
  function renderWaitingAuth(userCode, verificationUri) {
    activeUserCode = userCode || '';
    activeVerificationUri = verificationUri || AceConstants.GITHUB.VERIFICATION_URL;
    userCodeDisplay.textContent = activeUserCode || '----';
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
   * Refresh view based on background status
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
        renderWaitingAuth(response.authState.userCode, response.authState.verificationUri);
      } else if (response.status === AceConstants.AUTH_STATUS.FAILED && response.authState) {
        renderAuthFailed(response.authState.error);
      } else {
        setViewState(AceConstants.AUTH_STATUS.NOT_CONNECTED);
      }
    });
  }

  /**
   * Handle Connect Button Click
   */
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      const customClientId = clientIdInput ? clientIdInput.value.trim() : '';

      // Save client ID if entered
      if (customClientId) {
        await chrome.storage.local.set({
          [AceConstants.STORAGE_KEYS.CLIENT_ID]: customClientId
        });
      }

      connectBtn.disabled = true;
      connectBtn.textContent = 'Connecting...';

      chrome.runtime.sendMessage(
        {
          action: AceConstants.MESSAGES.START_AUTH,
          clientId: customClientId
        },
        (response) => {
          connectBtn.disabled = false;
          connectBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            Connect GitHub
          `;

          if (chrome.runtime.lastError || !response || !response.success) {
            const errorMsg = (response && response.error) || 'Failed to start authorization.';
            renderAuthFailed(errorMsg);
            return;
          }

          renderWaitingAuth(response.userCode, response.verificationUri);
        }
      );
    });
  }

  /**
   * Handle Copy Code Button Click
   */
  if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', async () => {
      if (!activeUserCode) return;
      try {
        await navigator.clipboard.writeText(activeUserCode);
        showToast('Code copied to clipboard!');
        copyCodeBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyCodeBtn.textContent = 'Copy Code';
        }, 2000);
      } catch (err) {
        showToast('Failed to copy code automatically.', true);
      }
    });
  }

  /**
   * Handle Open GitHub Verification Page
   */
  if (openVerifyBtn) {
    openVerifyBtn.addEventListener('click', () => {
      const url = activeVerificationUri || AceConstants.GITHUB.VERIFICATION_URL;
      chrome.tabs.create({ url: url });
    });
  }

  /**
   * Handle Immediate Approval Check Button Click
   */
  if (checkAuthBtn) {
    checkAuthBtn.addEventListener('click', () => {
      checkAuthBtn.disabled = true;
      checkAuthBtn.textContent = 'Verifying approval...';

      chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.CHECK_AUTH_NOW }, (response) => {
        checkAuthBtn.disabled = false;
        checkAuthBtn.textContent = "I've Approved on GitHub";

        if (chrome.runtime.lastError || !response) {
          showToast('Failed to connect with background service worker.', true);
          return;
        }

        if (response.success && response.user) {
          showToast('Successfully authenticated!');
          renderConnected(response.user);
          return;
        }

        if (response.pending) {
          showToast(response.message || 'Authorization still pending on GitHub.', false);
        } else if (response.error) {
          showToast(response.error, true);
          renderAuthFailed(response.error);
        }
      });
    });
  }

  /**
   * Handle Cancel Authorization Button
   */
  if (cancelAuthBtn) {
    cancelAuthBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: AceConstants.MESSAGES.CANCEL_AUTH }, () => {
        setViewState(AceConstants.AUTH_STATUS.NOT_CONNECTED);
      });
    });
  }

  /**
   * Handle Retry Authorization Button
   */
  if (retryAuthBtn) {
    retryAuthBtn.addEventListener('click', () => {
      setViewState(AceConstants.AUTH_STATUS.NOT_CONNECTED);
    });
  }

  /**
   * Handle Disconnect Button Click
   */
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

  /**
   * Handle Open Options Page
   */
  if (openOptionsBtn) {
    openOptionsBtn.addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('Options/options.html'));
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
  });

  // Initial status load
  refreshAuthStatus();
});
