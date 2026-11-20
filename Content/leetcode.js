/**
 * AceLC - LeetCode Content Script
 * Detects solution submissions, snapshots source code at submission time,
 * verifies accepted judging results, and transmits accepted submission
 * details to the background service worker.
 */

(() => {
  console.log('[AceLC Content] Initializing submission detector on:', window.location.href);

  // Fallback constants if shared script is unavailable
  const Constants = typeof AceConstants !== 'undefined' ? AceConstants : {
    MESSAGES: {
      SUBMISSION_DETECTED: 'ACE_SUBMISSION_DETECTED'
    },
    BRIDGE_EVENTS: {
      SUBMISSION_INITIATED: 'ACE_BRIDGE_SUBMISSION_INITIATED',
      SUBMISSION_ID_ASSIGNED: 'ACE_BRIDGE_SUBMISSION_ID_ASSIGNED',
      SUBMISSION_PENDING: 'ACE_BRIDGE_SUBMISSION_PENDING',
      SUBMISSION_ACCEPTED: 'ACE_BRIDGE_SUBMISSION_ACCEPTED',
      SUBMISSION_FAILED: 'ACE_BRIDGE_SUBMISSION_FAILED',
      REQUEST_MONACO_CODE: 'ACE_BRIDGE_REQUEST_MONACO_CODE',
      RESPONSE_MONACO_CODE: 'ACE_BRIDGE_RESPONSE_MONACO_CODE',
      URL_CHANGED: 'ACE_BRIDGE_URL_CHANGED'
    }
  };

  // State tracking
  let currentProblemSlug = null;
  let activeSubmissionSnapshot = null;
  const processedSubmissionKeys = new Set();
  let resultObserver = null;
  let lastObservedUrl = window.location.href;

  // Simple string hash utility for deduplication
  function simpleHashCode(str) {
    if (!str) return '0';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  /**
   * Check if extension context is valid
   * @returns {boolean}
   */
  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  /**
   * Safe message sender that suppresses Extension context invalidated errors
   * @param {object} message
   * @param {function} callback
   */
  function safeSendMessage(message, callback) {
    if (!isExtensionValid()) {
      console.warn('[AceLC Content] Extension reloaded. Please refresh the LeetCode page (F5) to re-enable AceLC.');
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (!isExtensionValid() || (chrome.runtime && chrome.runtime.lastError)) {
          return;
        }
        if (typeof callback === 'function') {
          callback(response);
        }
      });
    } catch (err) {
      console.warn('[AceLC Content] Message dispatch skipped (extension context may have been invalidated):', err.message);
    }
  }

  // =========================================================================
  // 1. PAGE AND PROBLEM IDENTIFICATION
  // =========================================================================

  /**
   * Determine if current page is a LeetCode problem page
   * @returns {string|null} Problem slug or null
   */
  function getCurrentProblemSlug() {
    if (typeof extractAceProblemSlug === 'function') {
      return extractAceProblemSlug(window.location.pathname);
    }
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    if (match && match[1] && match[1].toLowerCase() !== 'all') {
      return match[1].toLowerCase();
    }
    return null;
  }

  /**
   * Extract problem title, number, slug, and canonical URL
   * @returns {{ slug: string, title: string, number: string|null, url: string }}
   */
  function extractProblemMetadata() {
    const slug = getCurrentProblemSlug();
    if (!slug) return null;

    const canonicalUrl = `https://leetcode.com/problems/${slug}/`;
    let rawTitle = '';
    let problemNumber = null;

    // Selectors for problem title across different LeetCode layouts
    const titleSelectors = [
      '[data-cy="question-title"]',
      'div.text-title-large',
      'div[class*="text-title-"]',
      'a[href*="/problems/"] h1',
      'h1',
      'div.flex.items-center.text-lg'
    ];

    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent) {
        const text = el.textContent.trim();
        if (text && text.length > 0 && text.length < 150) {
          rawTitle = text;
          break;
        }
      }
    }

    let problemTitle = rawTitle;

    // Check if title starts with number prefix (e.g. "1. Two Sum" or "104. Maximum Depth")
    if (rawTitle) {
      const numMatch = rawTitle.match(/^(\d+)\.\s*(.+)$/);
      if (numMatch) {
        problemNumber = numMatch[1];
        problemTitle = numMatch[2].trim();
      }
    }

    // Fallback: If title not found in DOM, format slug to Title Case
    if (!problemTitle) {
      problemTitle = slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }

    return {
      slug,
      title: problemTitle,
      number: problemNumber,
      url: canonicalUrl
    };
  }

  // =========================================================================
  // 2. EDITOR CODE & LANGUAGE EXTRACTION AT SUBMISSION TIME
  // =========================================================================

  /**
   * Request code and language directly from Monaco editor via page bridge
   * @returns {Promise<{ code: string|null, language: string|null }>}
   */
  function requestMonacoFromBridge() {
    return new Promise((resolve) => {
      const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

      const timeoutId = setTimeout(() => {
        window.removeEventListener(Constants.BRIDGE_EVENTS.RESPONSE_MONACO_CODE, onResponse);
        resolve({ code: null, language: null });
      }, 500);

      function onResponse(event) {
        if (event && event.detail && event.detail.requestId === requestId) {
          clearTimeout(timeoutId);
          window.removeEventListener(Constants.BRIDGE_EVENTS.RESPONSE_MONACO_CODE, onResponse);
          resolve({
            code: event.detail.code || null,
            language: event.detail.language || null
          });
        }
      }

      window.addEventListener(Constants.BRIDGE_EVENTS.RESPONSE_MONACO_CODE, onResponse);
      window.dispatchEvent(new CustomEvent(Constants.BRIDGE_EVENTS.REQUEST_MONACO_CODE, {
        detail: { requestId }
      }));
    });
  }

  /**
   * Fallback: Extract code text directly from Monaco Editor DOM view lines
   * @returns {string|null}
   */
  function extractCodeFromDOM() {
    try {
      // 1. Check Monaco view lines
      const viewLines = document.querySelectorAll('.monaco-editor .view-line');
      if (viewLines && viewLines.length > 0) {
        const lines = Array.from(viewLines).map((line) => line.textContent || '');
        const joined = lines.join('\n');
        if (joined.trim().length > 0) {
          return joined;
        }
      }

      // 2. Check Monaco hidden textarea / inputarea
      const textarea = document.querySelector('.monaco-editor textarea.inputarea, textarea[wrap="off"]');
      if (textarea && textarea.value && textarea.value.trim().length > 0) {
        return textarea.value;
      }

      // 3. Check submission detail page code containers (if already navigated to /submissions/<id>/)
      const codeBlocks = document.querySelectorAll('pre code, pre.font-mono, pre[class*="language-"], div[class*="code-container"]');
      for (const block of codeBlocks) {
        const txt = block.textContent;
        if (txt && txt.trim().length > 10) {
          return txt;
        }
      }

      // 4. Check legacy CodeMirror lines
      const cmLines = document.querySelectorAll('.CodeMirror-line');
      if (cmLines && cmLines.length > 0) {
        const lines = Array.from(cmLines).map((line) => line.textContent || '');
        return lines.join('\n');
      }
    } catch (err) {
      console.warn('[AceLC Content] DOM code extraction failed:', err);
    }
    return null;
  }

  /**
   * Detect currently selected programming language from the editor UI
   * @returns {string} Raw language string
   */
  function detectLanguageFromDOM() {
    try {
      // 1. Look for language selector button in editor header
      const langSelectors = [
        'button[data-cy="lang-select"]',
        'button[id^="headlessui-listbox-button"]',
        'button[data-state][aria-haspopup="listbox"]'
      ];

      for (const sel of langSelectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.textContent) {
          const text = btn.textContent.trim();
          if (text && text.length < 30) {
            return text;
          }
        }
      }

      // 2. Look for editor toolbar buttons that match known language names
      const buttons = document.querySelectorAll('button');
      const knownLanguages = [
        'c++', 'cpp', 'java', 'python3', 'python', 'c#', 'csharp', 'javascript',
        'typescript', 'golang', 'go', 'ruby', 'swift', 'kotlin', 'rust', 'php',
        'dart', 'scala', 'racket', 'erlang', 'elixir'
      ];

      for (const btn of buttons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (knownLanguages.includes(text)) {
          return (btn.textContent || '').trim();
        }
      }
    } catch (e) {}

    return 'unknown';
  }

  /**
   * Capture complete snapshot of the solution and problem at submission time
   * @returns {Promise<object|null>}
   */
  async function captureSubmissionSnapshot() {
    const meta = extractProblemMetadata();
    if (!meta) {
      console.warn('[AceLC Content] Cannot capture submission: Not on a problem page.');
      return null;
    }

    // Try reading Monaco directly from bridge
    const monacoResult = await requestMonacoFromBridge();

    let code = monacoResult.code;
    let rawLang = monacoResult.language;

    // Fallback: extract code from DOM if bridge had no code
    if (!code || code.trim().length === 0) {
      code = extractCodeFromDOM();
    }

    // Fallback: extract language from DOM if bridge had no language
    if (!rawLang || rawLang === 'unknown') {
      rawLang = detectLanguageFromDOM();
    }

    const langInfo = typeof normalizeAceLanguage === 'function'
      ? normalizeAceLanguage(rawLang)
      : { id: rawLang || 'unknown', name: rawLang || 'Text', ext: '.txt' };

    const snapshot = {
      problemTitle: meta.title,
      problemSlug: meta.slug,
      problemUrl: meta.url,
      problemNumber: meta.number,
      code: code || '',
      language: langInfo.name,
      languageId: langInfo.id,
      languageExt: langInfo.ext,
      submissionId: null,
      timestamp: Date.now()
    };

    console.log('[AceLC Content] Captured submission snapshot at submit time:');
    console.log(`  Problem: [${meta.number || '?'}] ${meta.title} (${meta.slug})`);
    console.log(`  Language: ${langInfo.name} (${langInfo.id})`);
    console.log(`  Code length: ${snapshot.code.length} characters`);

    return snapshot;
  }

  // =========================================================================
  // 3. SUBMISSION TRIGGER LISTENER (BUTTON CLICK & KEYBOARD SHORTCUT)
  // =========================================================================

  /**
   * Check if a DOM element is the Submit button
   * @param {Element} element 
   * @returns {boolean}
   */
  function isSubmitButton(element) {
    if (!element) return false;
    const btn = element.closest('button, [role="button"]');
    if (!btn) return false;

    // Check data attributes
    if (btn.getAttribute('data-e2e-locator') === 'console-submit-button') return true;
    if (btn.getAttribute('data-cypress') === 'submit-code-btn') return true;

    // Check visible text
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'submit' || text.startsWith('submit')) return true;

    return false;
  }

  /**
   * Handle user initiating a submission
   */
  async function onSubmissionTriggered() {
    const slug = getCurrentProblemSlug();
    if (!slug) return;

    console.log('[AceLC Content] Submission action triggered by user on problem:', slug);

    // Snapshot immediately at submission time
    activeSubmissionSnapshot = await captureSubmissionSnapshot();

    // Start active DOM observer for judging result
    startResultObserver();
  }

  // Global event delegation for submit button clicks
  document.addEventListener('click', (event) => {
    if (isSubmitButton(event.target)) {
      onSubmissionTriggered();
    }
  }, true);

  // Keyboard shortcut listener: Ctrl+Enter / Cmd+Enter
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      onSubmissionTriggered();
    }
  }, true);

  // =========================================================================
  // 4. BRIDGE EVENTS LISTENER (NETWORK INTERCEPTION)
  // =========================================================================

  // Handle messages from pageBridge (both CustomEvent and window.postMessage)
  function handleBridgeMessage(type, detail) {
    if (!type || !detail) return;

    if (type === Constants.BRIDGE_EVENTS.SUBMISSION_INITIATED) {
      console.log('[AceLC Content] Network submission initiated intercepted for:', detail.slug);
      const meta = extractProblemMetadata();
      const rawLang = detail.language || detectLanguageFromDOM();
      const langInfo = typeof normalizeAceLanguage === 'function'
        ? normalizeAceLanguage(rawLang)
        : { id: rawLang, name: rawLang, ext: '.txt' };

      // Update active snapshot with exact submitted source code from HTTP payload
      activeSubmissionSnapshot = {
        problemTitle: meta ? meta.title : (detail.slug || ''),
        problemSlug: detail.slug || (meta ? meta.slug : ''),
        problemUrl: meta ? meta.url : `https://leetcode.com/problems/${detail.slug}/`,
        problemNumber: meta ? meta.number : null,
        code: detail.code || (activeSubmissionSnapshot ? activeSubmissionSnapshot.code : ''),
        language: langInfo.name,
        languageId: langInfo.id,
        languageExt: langInfo.ext,
        submissionId: null,
        timestamp: detail.timestamp || Date.now()
      };

      startResultObserver();
      return;
    }

    if (type === Constants.BRIDGE_EVENTS.SUBMISSION_ID_ASSIGNED) {
      if (activeSubmissionSnapshot) {
        activeSubmissionSnapshot.submissionId = String(detail.submissionId);
        console.log('[AceLC Content] Submission assigned ID:', detail.submissionId);
      }
      return;
    }

    if (type === Constants.BRIDGE_EVENTS.SUBMISSION_PENDING) {
      // Ignored: Still evaluating
      return;
    }

    if (type === Constants.BRIDGE_EVENTS.SUBMISSION_ACCEPTED) {
      console.log('[AceLC Content] Submission ACCEPTED via network signal! ID:', detail.submissionId);
      processAcceptedSubmission({
        submissionId: detail.submissionId,
        runtime: detail.runtime,
        memory: detail.memory,
        totalCorrect: detail.totalCorrect,
        totalTestcases: detail.totalTestcases
      });
      return;
    }

    if (type === Constants.BRIDGE_EVENTS.SUBMISSION_FAILED) {
      console.log(`[AceLC Content] Submission judged as "${detail.statusMsg}". (Ignored - Not Accepted)`);
      activeSubmissionSnapshot = null;
      stopResultObserver();
      return;
    }

    if (type === Constants.BRIDGE_EVENTS.URL_CHANGED) {
      handlePageNavigation();
      return;
    }
  }

  // Listen for CustomEvents
  for (const eventName of Object.values(Constants.BRIDGE_EVENTS)) {
    window.addEventListener(eventName, (e) => {
      handleBridgeMessage(eventName, e.detail);
    });
  }

  // Listen for window.postMessage
  window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'ACELC_PAGE_BRIDGE') {
      handleBridgeMessage(event.data.type, event.data.detail);
    }
  });

  // =========================================================================
  // 5. DOM RESULT OBSERVATION (FALLBACK LAYER)
  // =========================================================================

  /**
   * Inspect DOM for Accepted submission indicator
   */
  function inspectDOMForSubmissionResult() {
    if (!activeSubmissionSnapshot) return;

    // Do not process if submission is older than 90 seconds
    if (Date.now() - activeSubmissionSnapshot.timestamp > 90000) {
      activeSubmissionSnapshot = null;
      stopResultObserver();
      return;
    }

    // 1. Look for submission result container
    const resultEl = document.querySelector('[data-e2e-locator="submission-result"]');
    if (resultEl && resultEl.textContent) {
      const text = resultEl.textContent.trim();

      // Check pending/judging state
      if (text.toLowerCase().includes('pending') || text.toLowerCase().includes('judging')) {
        return; // Wait for final result
      }

      // Check accepted state
      if (text.toLowerCase() === 'accepted') {
        const runtimeEl = document.querySelector('[data-e2e-locator="submission-runtime"]');
        const memoryEl = document.querySelector('[data-e2e-locator="submission-memory"]');

        let submissionId = activeSubmissionSnapshot.submissionId;
        if (!submissionId) {
          const detailLink = document.querySelector('a[href*="/submissions/detail/"]');
          if (detailLink) {
            const m = detailLink.getAttribute('href').match(/\/submissions\/detail\/([^/]+)/);
            if (m) submissionId = m[1];
          }
        }

        console.log('[AceLC Content] Submission ACCEPTED via DOM signal!');
        processAcceptedSubmission({
          submissionId,
          runtime: runtimeEl ? runtimeEl.textContent.trim() : null,
          memory: memoryEl ? memoryEl.textContent.trim() : null
        });
        return;
      }

      // Check non-accepted final results (Wrong Answer, TLE, etc.)
      const failedKeywords = ['wrong answer', 'time limit exceeded', 'runtime error', 'compile error', 'memory limit exceeded'];
      for (const kw of failedKeywords) {
        if (text.toLowerCase().includes(kw)) {
          console.log(`[AceLC Content] DOM result showed "${text}". (Ignored - Not Accepted)`);
          activeSubmissionSnapshot = null;
          stopResultObserver();
          return;
        }
      }
    }
  }

  function startResultObserver() {
    stopResultObserver();
    resultObserver = new MutationObserver(() => {
      inspectDOMForSubmissionResult();
    });

    resultObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Also set a 90s safety timeout to stop observer
    setTimeout(() => {
      stopResultObserver();
    }, 90000);
  }

  function stopResultObserver() {
    if (resultObserver) {
      resultObserver.disconnect();
      resultObserver = null;
    }
  }

  // =========================================================================
  // 6. ACCEPTED SUBMISSION PROCESSING & DEDUPLICATION
  // =========================================================================

  /**
   * Process and transmit verified accepted submission to background worker
   * @param {object} resultDetails 
   */
  async function processAcceptedSubmission(resultDetails) {
    let snapshot = activeSubmissionSnapshot;

    // If snapshot was missing, attempt immediate capture
    if (!snapshot || !snapshot.code) {
      snapshot = await captureSubmissionSnapshot();
    }

    if (!snapshot || !snapshot.code) {
      console.warn('[AceLC Content] Cannot process submission: No source code captured.');
      activeSubmissionSnapshot = null;
      stopResultObserver();
      return;
    }

    const submissionId = resultDetails.submissionId || snapshot.submissionId || null;
    const codeHash = simpleHashCode(snapshot.code);
    const dedupKey = submissionId
      ? `id_${submissionId}`
      : `${snapshot.problemSlug}_${codeHash}_${Math.floor(Date.now() / 20000)}`;

    // Prevent duplicate processing
    if (processedSubmissionKeys.has(dedupKey)) {
      console.log('[AceLC Content] Duplicate submission already processed, skipping:', dedupKey);
      activeSubmissionSnapshot = null;
      stopResultObserver();
      return;
    }

    processedSubmissionKeys.add(dedupKey);

    // Build standard payload
    const submissionPayload = {
      problemTitle: snapshot.problemTitle,
      problemSlug: snapshot.problemSlug,
      problemUrl: snapshot.problemUrl,
      problemNumber: snapshot.problemNumber,
      code: snapshot.code,
      language: snapshot.language,
      languageId: snapshot.languageId,
      languageExt: snapshot.languageExt,
      submissionId: submissionId,
      runtime: resultDetails.runtime || null,
      memory: resultDetails.memory || null,
      timestamp: Date.now()
    };

    console.log('[AceLC Content] Transmitting accepted submission to background worker:');
    console.log(`  Problem: [${submissionPayload.problemNumber || '?'}] ${submissionPayload.problemTitle}`);
    console.log(`  Slug: ${submissionPayload.problemSlug}`);
    console.log(`  Language: ${submissionPayload.language}`);
    console.log(`  Submission ID: ${submissionPayload.submissionId || 'N/A'}`);
    console.log(`  Code length: ${submissionPayload.code.length} chars`);

    // Dispatch message to background service worker safely
    safeSendMessage(
      {
        action: Constants.MESSAGES.SUBMISSION_DETECTED,
        submission: submissionPayload
      },
      (response) => {
        if (response && response.success && response.submission) {
          console.log('[AceLC Content] Background worker successfully received submission:', response);
          // Show destination selection modal directly on the page
          showDestinationModal(
            response.submission,
            response.repository,
            response.folders || []
          );
        }
      }
    );

    activeSubmissionSnapshot = null;
    stopResultObserver();
  }

  // =========================================================================
  // 7. IN-PAGE DESTINATION SELECTION MODAL (PHASE 6)
  // =========================================================================

  /**
   * Inject scoped styles for the in-page destination selection modal
   */
  function injectModalStyles() {
    if (document.getElementById('acelc-dest-modal-styles')) return;

    const styleEl = document.createElement('style');
    styleEl.id = 'acelc-dest-modal-styles';
    styleEl.textContent = `
      #acelc-dest-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(15, 23, 42, 0.65);
        backdrop-filter: blur(4px);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        color: #1e293b;
        animation: acelc-fade-in 0.2s ease-out;
      }
      @keyframes acelc-fade-in {
        from { opacity: 0; transform: scale(0.97); }
        to { opacity: 1; transform: scale(1); }
      }
      #acelc-dest-modal {
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08);
        width: 440px;
        max-width: 92vw;
        max-height: 90vh;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        padding: 20px;
        gap: 14px;
        border: 1px solid #e2e8f0;
      }
      .acelc-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #f1f5f9;
        padding-bottom: 12px;
      }
      .acelc-brand-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .acelc-brand-badge {
        background: #e0e7ff;
        color: #4338ca;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 4px;
      }
      .acelc-modal-title {
        font-size: 16px;
        font-weight: 700;
        color: #0f172a;
      }
      .acelc-close-btn {
        background: transparent;
        border: none;
        font-size: 20px;
        color: #64748b;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 6px;
        line-height: 1;
      }
      .acelc-close-btn:hover {
        background: #f1f5f9;
        color: #0f172a;
      }
      .acelc-summary-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .acelc-problem-name {
        font-size: 15px;
        font-weight: 600;
        color: #0f172a;
      }
      .acelc-badge-row {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
      }
      .acelc-tag {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 4px;
        background: #e2e8f0;
        color: #334155;
      }
      .acelc-tag-lang {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .acelc-tag-success {
        background: #dcfce7;
        color: #15803d;
      }
      .acelc-section-label {
        font-size: 12px;
        font-weight: 600;
        color: #475569;
        margin-bottom: 4px;
        display: block;
      }
      .acelc-repo-box {
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 8px 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;
      }
      .acelc-repo-name {
        font-weight: 600;
        color: #0f172a;
      }
      .acelc-folders-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .acelc-toggle-all-btn {
        background: transparent;
        border: none;
        color: #2563eb;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        padding: 0;
      }
      .acelc-toggle-all-btn:hover {
        text-decoration: underline;
      }
      .acelc-folders-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 180px;
        overflow-y: auto;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 8px;
        background: #ffffff;
      }
      .acelc-folder-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.1s ease;
      }
      .acelc-folder-item:hover {
        background: #f1f5f9;
      }
      .acelc-folder-checkbox {
        accent-color: #2da44e;
        cursor: pointer;
        width: 15px;
        height: 15px;
      }
      .acelc-folder-label {
        font-size: 12px;
        font-weight: 500;
        color: #1e293b;
        cursor: pointer;
        flex: 1;
      }
      .acelc-empty-folders-box {
        padding: 10px;
        background: #fffbeb;
        border: 1px solid #fef3c7;
        border-radius: 6px;
        font-size: 12px;
        color: #92400e;
      }
      .acelc-quick-add-row {
        display: flex;
        gap: 6px;
        margin-top: 6px;
      }
      .acelc-quick-add-input {
        flex: 1;
        padding: 5px 8px;
        font-size: 12px;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        outline: none;
      }
      .acelc-quick-add-btn {
        background: #0f172a;
        color: #ffffff;
        border: none;
        border-radius: 4px;
        padding: 5px 10px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .acelc-validation-error {
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #b91c1c;
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 500;
      }
      .acelc-actions-row {
        display: flex;
        gap: 10px;
        margin-top: 4px;
      }
      .acelc-btn-confirm {
        flex: 1;
        background: #2da44e;
        color: #ffffff;
        border: none;
        border-radius: 6px;
        padding: 9px 14px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.15s ease;
      }
      .acelc-btn-confirm:hover {
        background: #2c974b;
      }
      .acelc-btn-confirm:disabled {
        background: #94a3b8;
        cursor: not-allowed;
      }
      .acelc-btn-cancel {
        background: #f1f5f9;
        color: #334155;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 9px 14px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.15s ease;
      }
      .acelc-btn-cancel:hover {
        background: #e2e8f0;
      }
      .acelc-success-banner {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        color: #166534;
        border-radius: 6px;
        padding: 10px;
        text-align: center;
        font-weight: 600;
        font-size: 13px;
      }
    `;
    document.head.appendChild(styleEl);
  }

  /**
   * Display in-page destination selection modal for an accepted submission
   * @param {object} submission
   * @param {object} repository
   * @param {Array<string>} initialFolders
   */
  function showDestinationModal(submission, repository, initialFolders) {
    if (!submission) return;

    // Remove any existing modal
    const existing = document.getElementById('acelc-dest-overlay');
    if (existing) existing.remove();

    injectModalStyles();

    let folders = Array.isArray(initialFolders) ? [...initialFolders] : [];

    const overlay = document.createElement('div');
    overlay.id = 'acelc-dest-overlay';

    const modal = document.createElement('div');
    modal.id = 'acelc-dest-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'acelc-modal-header';

    const brandRow = document.createElement('div');
    brandRow.className = 'acelc-brand-row';

    const brandBadge = document.createElement('span');
    brandBadge.className = 'acelc-brand-badge';
    brandBadge.textContent = 'AceLC';

    const modalTitle = document.createElement('span');
    modalTitle.className = 'acelc-modal-title';
    modalTitle.textContent = 'Solution Accepted! 🎉';

    brandRow.appendChild(brandBadge);
    brandRow.appendChild(modalTitle);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'acelc-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Dismiss';
    closeBtn.onclick = () => {
      cancelModal();
    };

    header.appendChild(brandRow);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Problem Summary Card
    const summaryCard = document.createElement('div');
    summaryCard.className = 'acelc-summary-card';

    const problemName = document.createElement('div');
    problemName.className = 'acelc-problem-name';
    const numDisplay = submission.problemNumber ? `#${submission.problemNumber} ` : '';
    problemName.textContent = `${numDisplay}${submission.problemTitle}`;

    const badgeRow = document.createElement('div');
    badgeRow.className = 'acelc-badge-row';

    const langTag = document.createElement('span');
    langTag.className = 'acelc-tag acelc-tag-lang';
    langTag.textContent = submission.language || 'Unknown Language';

    const statusTag = document.createElement('span');
    statusTag.className = 'acelc-tag acelc-tag-success';
    statusTag.textContent = '✓ Accepted';

    badgeRow.appendChild(langTag);
    badgeRow.appendChild(statusTag);

    if (submission.runtime) {
      const runtimeTag = document.createElement('span');
      runtimeTag.className = 'acelc-tag';
      runtimeTag.textContent = submission.runtime;
      badgeRow.appendChild(runtimeTag);
    }

    if (submission.memory) {
      const memoryTag = document.createElement('span');
      memoryTag.className = 'acelc-tag';
      memoryTag.textContent = submission.memory;
      badgeRow.appendChild(memoryTag);
    }

    summaryCard.appendChild(problemName);
    summaryCard.appendChild(badgeRow);
    modal.appendChild(summaryCard);

    // Destination Repository
    const repoSection = document.createElement('div');
    const repoLabel = document.createElement('span');
    repoLabel.className = 'acelc-section-label';
    repoLabel.textContent = 'Target Repository:';

    const repoBox = document.createElement('div');
    repoBox.className = 'acelc-repo-box';

    const repoNameSpan = document.createElement('span');
    repoNameSpan.className = 'acelc-repo-name';
    repoNameSpan.textContent = repository ? repository.fullName : 'No repository selected';

    const repoBadgeSpan = document.createElement('span');
    repoBadgeSpan.className = 'acelc-tag';
    repoBadgeSpan.textContent = repository ? (repository.isPrivate ? 'Private' : 'Public') : 'Not Configured';

    repoBox.appendChild(repoNameSpan);
    repoBox.appendChild(repoBadgeSpan);
    repoSection.appendChild(repoLabel);
    repoSection.appendChild(repoBox);
    modal.appendChild(repoSection);

    // Destination Folders Checklist Section
    const foldersSection = document.createElement('div');

    const foldersHeader = document.createElement('div');
    foldersHeader.className = 'acelc-folders-header';

    const foldersLabel = document.createElement('span');
    foldersLabel.className = 'acelc-section-label';
    foldersLabel.textContent = 'Select Destination Folders:';

    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.className = 'acelc-toggle-all-btn';
    toggleAllBtn.type = 'button';
    toggleAllBtn.textContent = 'Deselect All';

    foldersHeader.appendChild(foldersLabel);
    foldersHeader.appendChild(toggleAllBtn);
    foldersSection.appendChild(foldersHeader);

    const foldersList = document.createElement('div');
    foldersList.className = 'acelc-folders-list';

    function renderFolderItems() {
      foldersList.innerHTML = '';

      if (folders.length === 0) {
        toggleAllBtn.style.display = 'none';

        const emptyBox = document.createElement('div');
        emptyBox.className = 'acelc-empty-folders-box';
        emptyBox.innerHTML = `
          <strong>No folders configured.</strong><br>
          Type a destination folder path to add one:
        `;

        const quickAddRow = document.createElement('div');
        quickAddRow.className = 'acelc-quick-add-row';

        const quickInput = document.createElement('input');
        quickInput.type = 'text';
        quickInput.className = 'acelc-quick-add-input';
        quickInput.placeholder = 'e.g. Easy or Solutions/Python';

        const quickBtn = document.createElement('button');
        quickBtn.type = 'button';
        quickBtn.className = 'acelc-quick-add-btn';
        quickBtn.textContent = 'Add Folder';

        function handleQuickAdd() {
          const val = quickInput.value.trim().replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '');
          if (!val) return;
          if (!folders.includes(val)) {
            folders.push(val);
            // Save to chrome.storage
            safeSendMessage({
              action: Constants.MESSAGES.ADD_DESTINATION_FOLDER,
              folderPath: val
            });
            renderFolderItems();
          }
        }

        quickBtn.onclick = handleQuickAdd;
        quickInput.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleQuickAdd();
          }
        };

        quickAddRow.appendChild(quickInput);
        quickAddRow.appendChild(quickBtn);
        emptyBox.appendChild(quickAddRow);
        foldersList.appendChild(emptyBox);
        return;
      }

      toggleAllBtn.style.display = 'block';

      for (const f of folders) {
        const item = document.createElement('label');
        item.className = 'acelc-folder-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'acelc-folder-checkbox';
        cb.value = f;
        cb.checked = true;

        const lbl = document.createElement('span');
        lbl.className = 'acelc-folder-label';
        lbl.textContent = `📁 ${f}`;

        item.appendChild(cb);
        item.appendChild(lbl);
        foldersList.appendChild(item);
      }
    }

    renderFolderItems();
    foldersSection.appendChild(foldersList);

    // Validation Error Element
    const validationError = document.createElement('div');
    validationError.className = 'acelc-validation-error';
    validationError.style.display = 'none';
    validationError.textContent = 'Please select at least one destination folder.';
    foldersSection.appendChild(validationError);

    modal.appendChild(foldersSection);

    // Toggle All functionality
    let allSelected = true;
    toggleAllBtn.onclick = () => {
      const checkboxes = foldersList.querySelectorAll('.acelc-folder-checkbox');
      allSelected = !allSelected;
      checkboxes.forEach((cb) => (cb.checked = allSelected));
      toggleAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
      if (allSelected) validationError.style.display = 'none';
    };

    // Actions Row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'acelc-actions-row';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'acelc-btn-confirm';
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Upload Solution';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'acelc-btn-cancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';

    function cancelModal() {
      safeSendMessage({
        action: Constants.MESSAGES.CANCEL_DESTINATION_SELECTION,
        payload: { submissionUid: submission.uid }
      });
      overlay.remove();
    }

    confirmBtn.onclick = () => {
      const checkboxes = foldersList.querySelectorAll('.acelc-folder-checkbox:checked');
      const selected = Array.from(checkboxes).map((cb) => cb.value);

      if (selected.length === 0) {
        validationError.textContent = 'Please select at least one destination folder.';
        validationError.style.display = 'block';
        return;
      }

      validationError.style.display = 'none';
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      confirmBtn.textContent = 'Confirming Selection...';

      safeSendMessage(
        {
          action: Constants.MESSAGES.CONFIRM_DESTINATION_SELECTION,
          payload: {
            submissionUid: submission.uid,
            selectedFolders: selected
          }
        },
        (response) => {
          if (response && response.success) {
            modal.innerHTML = `
              <div class="acelc-success-banner">
                ✓ Destination confirmed! Solution queued for upload.
              </div>
            `;
            setTimeout(() => {
              overlay.remove();
            }, 1400);
          } else {
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            confirmBtn.textContent = 'Upload Solution';
            validationError.textContent = (response && response.error) || 'Failed to confirm destination selection.';
            validationError.style.display = 'block';
          }
        }
      );
    };

    cancelBtn.onclick = cancelModal;

    actionsRow.appendChild(confirmBtn);
    actionsRow.appendChild(cancelBtn);
    modal.appendChild(actionsRow);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // Listen for background worker messages to show destination modal
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === Constants.MESSAGES.SHOW_DESTINATION_MODAL) {
      console.log('[AceLC Content] Received SHOW_DESTINATION_MODAL for problem:', message.submission.problemSlug);
      showDestinationModal(message.submission, message.repository, message.folders);
      sendResponse({ success: true, shown: true });
      return false;
    }
  });

  // =========================================================================
  // 8. SPA NAVIGATION & LEETCODE UI CHANGE HANDLING
  // =========================================================================

  function handlePageNavigation() {
    const newUrl = window.location.href;
    if (newUrl === lastObservedUrl) return;
    lastObservedUrl = newUrl;

    const newSlug = getCurrentProblemSlug();
    if (newSlug !== currentProblemSlug) {
      console.log(`[AceLC Content] Navigated to problem: ${newSlug || 'none'}`);
      currentProblemSlug = newSlug;
      activeSubmissionSnapshot = null;
      stopResultObserver();
    }
  }

  // Periodic URL check for client-side routing
  setInterval(handlePageNavigation, 1000);
  window.addEventListener('popstate', handlePageNavigation);
  window.addEventListener('hashchange', handlePageNavigation);

  // Initialize on load
  currentProblemSlug = getCurrentProblemSlug();
  if (currentProblemSlug) {
    console.log('[AceLC Content] Loaded on problem page:', currentProblemSlug);
  }
})();
