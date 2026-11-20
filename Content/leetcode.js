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
      const textarea = document.querySelector('.monaco-editor textarea.inputarea');
      if (textarea && textarea.value && textarea.value.trim().length > 0) {
        return textarea.value;
      }

      // 3. Check legacy CodeMirror lines
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
    const btn = element.closest('button');
    if (!btn) return false;

    // Check data attributes
    if (btn.getAttribute('data-e2e-locator') === 'console-submit-button') return true;
    if (btn.getAttribute('data-cypress') === 'submit-code-btn') return true;

    // Check visible text
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'submit') return true;

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

    // Dispatch message to background service worker
    try {
      chrome.runtime.sendMessage(
        {
          action: Constants.MESSAGES.SUBMISSION_DETECTED,
          submission: submissionPayload
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('[AceLC Content] Failed sending message to background:', chrome.runtime.lastError.message);
            return;
          }
          console.log('[AceLC Content] Background worker successfully received submission:', response);
        }
      );
    } catch (err) {
      console.error('[AceLC Content] Unexpected error sending submission:', err);
    }

    activeSubmissionSnapshot = null;
    stopResultObserver();
  }

  // =========================================================================
  // 7. SPA NAVIGATION & LEETCODE UI CHANGE HANDLING
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
