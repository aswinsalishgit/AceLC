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
   * Extract problem difficulty from DOM
   * Supported: 'Easy', 'Medium', 'Hard'
   * @returns {string} Difficulty
   */
  function extractProblemDifficulty() {
    const diffSelectors = [
      'div[class*="text-difficulty-"]',
      'span[class*="text-difficulty-"]',
      'div[class*="difficulty-"]',
      '[data-degree]',
      'div.text-olive',
      'div.text-yellow',
      'div.text-pink',
      'div.text-success',
      'div.text-warning',
      'div.text-danger'
    ];

    for (const sel of diffSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent) {
        const text = el.textContent.trim().toLowerCase();
        if (text.includes('easy')) return 'Easy';
        if (text.includes('medium')) return 'Medium';
        if (text.includes('hard')) return 'Hard';
      }
    }

    // Secondary scan across any element with Easy/Medium/Hard text
    const allBadges = document.querySelectorAll('div, span');
    for (const badge of allBadges) {
      if (badge.children.length === 0) {
        const text = (badge.textContent || '').trim();
        if (text === 'Easy' || text === 'Medium' || text === 'Hard') {
          return text;
        }
      }
    }

    return 'Medium'; // Default fallback
  }

  /**
   * Extract question metadata and content from Next.js SSR data if available
   * Strictly matches the requested problem slug to prevent cross-problem pollution.
   * @param {string} slug
   * @returns {object|null}
   */
  function getProblemDataFromNextData(slug) {
    if (!slug) return null;
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el || !el.textContent) return null;
      const data = JSON.parse(el.textContent);

      const targetSlug = String(slug).toLowerCase().trim();
      const queries = data?.props?.pageProps?.dehydratedState?.queries;
      if (Array.isArray(queries)) {
        for (const q of queries) {
          const question = q?.state?.data?.question;
          if (question && (question.titleSlug || '').toLowerCase().trim() === targetSlug) {
            return question;
          }
        }
      }
      const pageQ = data?.props?.pageProps?.question;
      if (pageQ && (pageQ.titleSlug || '').toLowerCase().trim() === targetSlug) {
        return pageQ;
      }
    } catch (e) {
      console.warn('[AceLC Content] Failed parsing __NEXT_DATA__:', e);
    }
    return null;
  }

  /**
   * Fetch question details via LeetCode's public GraphQL endpoint
   * @param {string} slug
   * @returns {Promise<object|null>}
   */
  async function fetchProblemDataFromGraphQL(slug) {
    if (!slug) return null;
    try {
      const res = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query getQuestionDetail($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              questionId
              questionFrontendId
              title
              titleSlug
              difficulty
              content
            }
          }`,
          variables: { titleSlug: slug }
        })
      });
      if (res.ok) {
        const json = await res.json();
        return json?.data?.question || null;
      }
    } catch (e) {
      console.warn('[AceLC Content] GraphQL question fetch failed:', e);
    }
    return null;
  }

  /**
   * Extract complete problem statement content from DOM or HTML string
   * @param {string} [contentHtml]
   * @returns {string} Markdown/text problem statement
   */
  function extractProblemStatement(contentHtml) {
    if (contentHtml && typeof contentHtml === 'string' && contentHtml.trim().length > 20) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(contentHtml, 'text/html');
        const md = htmlToMarkdown(doc.body);
        if (md && md.trim().length > 20) return md;
      } catch (e) {}
    }

    const contentSelectors = [
      '[data-track-load="description_content"]',
      'div.question-content__JfgR',
      'div[class*="question-content"]',
      'div._1l1Q',
      'div.content__uRbb',
      'div[data-key="description-content"]',
      'div[class*="elfjS"]'
    ];

    let contentEl = null;
    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 30) {
        contentEl = el;
        break;
      }
    }

    if (!contentEl) {
      return '';
    }

    // Convert HTML elements to clean markdown-like text
    return htmlToMarkdown(contentEl);
  }

  /**
   * Convert an HTML problem content node to formatted Markdown text
   * @param {Element} node 
   * @returns {string}
   */
  function htmlToMarkdown(node) {
    if (!node) return '';

    // Clone to avoid mutating live DOM
    const clone = node.cloneNode(true);

    // Remove buttons, toolbars, or dynamic action widgets inside question content
    const unwanted = clone.querySelectorAll('button, svg, [role="button"], script, style');
    unwanted.forEach((el) => el.remove());

    // Replace <code> tags with backticks
    const codeTags = clone.querySelectorAll('code');
    codeTags.forEach((c) => {
      if (c.parentElement && c.parentElement.tagName === 'PRE') {
        // Handled in pre block
      } else {
        c.textContent = '`' + c.textContent + '`';
      }
    });

    // Replace <pre> blocks with ``` code fences
    const preTags = clone.querySelectorAll('pre');
    preTags.forEach((p) => {
      p.textContent = '\n\n```\n' + p.textContent.trim() + '\n```\n\n';
    });

    // Replace <strong>/<b> with **
    const boldTags = clone.querySelectorAll('strong, b');
    boldTags.forEach((b) => {
      b.textContent = '**' + b.textContent + '**';
    });

    // Replace <em>/<i> with *
    const italicTags = clone.querySelectorAll('em, i');
    italicTags.forEach((i) => {
      i.textContent = '*' + i.textContent + '*';
    });

    // Replace headers
    for (let h = 1; h <= 6; h++) {
      const headers = clone.querySelectorAll('h' + h);
      headers.forEach((hdr) => {
        hdr.textContent = '\n\n' + '#'.repeat(h) + ' ' + hdr.textContent.trim() + '\n\n';
      });
    }

    // Replace list items
    const listItems = clone.querySelectorAll('li');
    listItems.forEach((li) => {
      li.textContent = '\n- ' + li.textContent.trim();
    });

    // Replace paragraphs and line breaks
    const paragraphs = clone.querySelectorAll('p');
    paragraphs.forEach((p) => {
      p.textContent = '\n\n' + p.textContent.trim() + '\n\n';
    });

    let text = clone.textContent || '';
    // Normalize excessive newlines
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text;
  }

  /**
   * Sanitize metrics string to remove all newlines and whitespace artifacts
   * @param {any} val
   * @returns {string|null}
   */
  function sanitizeMetric(val) {
    if (!val) return null;
    return String(val)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Scrape actual runtime, memory, and Beats percentages from LeetCode DOM
   * @returns {{ runtime: string|null, memory: string|null, runtimePercentile: number|null, memoryPercentile: number|null }}
   */
  function extractMetricsFromDOM() {
    let runtime = null;
    let runtimePercentile = null;
    let memory = null;
    let memoryPercentile = null;

    const rawBodyText = (document.body && document.body.innerText) ? document.body.innerText : '';
    // Normalize newlines in body text so multi-line text matches cleanly
    const bodyText = rawBodyText.replace(/[\r\n\t]+/g, ' ');

    // 1. Search for Runtime: e.g. "Runtime 2 ms | Beats 62.71%" or "Runtime: 2 ms Beats 62.71%"
    const runtimeMatch = bodyText.match(/(?:Runtime|Execution time)[\s\S]{0,150}?(\d+(?:\.\d+)?\s*ms)[\s\S]{0,150}?Beats\s*(\d+(?:\.\d+)?)\s*%/i);
    if (runtimeMatch) {
      runtime = sanitizeMetric(runtimeMatch[1]);
      runtimePercentile = parseFloat(runtimeMatch[2]);
    } else {
      const rSolo = bodyText.match(/(?:Runtime|Execution time)[\s\S]{0,80}?(\d+(?:\.\d+)?\s*ms)/i);
      if (rSolo) runtime = sanitizeMetric(rSolo[1]);
      const rPctSolo = bodyText.match(/(?:Runtime|Execution time)[\s\S]{0,180}?Beats\s*(\d+(?:\.\d+)?)\s*%/i);
      if (rPctSolo) runtimePercentile = parseFloat(rPctSolo[1]);
    }

    // 2. Search for Memory: e.g. "Memory 85.09 MB | Beats 52.60%"
    const memoryMatch = bodyText.match(/Memory[\s\S]{0,150}?(\d+(?:\.\d+)?\s*(?:MB|KB|GB))[\s\S]{0,150}?Beats\s*(\d+(?:\.\d+)?)\s*%/i);
    if (memoryMatch) {
      memory = sanitizeMetric(memoryMatch[1]);
      memoryPercentile = parseFloat(memoryMatch[2]);
    } else {
      const mSolo = bodyText.match(/Memory[\s\S]{0,80}?(\d+(?:\.\d+)?\s*(?:MB|KB|GB))/i);
      if (mSolo) memory = sanitizeMetric(mSolo[1]);
      const mPctSolo = bodyText.match(/Memory[\s\S]{0,180}?Beats\s*(\d+(?:\.\d+)?)\s*%/i);
      if (mPctSolo) memoryPercentile = parseFloat(mPctSolo[1]);
    }

    // 3. Fallback: inspect specific DOM leaf elements for Beats percentages
    if (runtimePercentile == null || memoryPercentile == null) {
      try {
        const allLeafs = Array.from(document.querySelectorAll('span, div, p')).filter((el) => {
          return el.children.length === 0 && (el.textContent || '').includes('Beats') && (el.textContent || '').includes('%');
        });
        for (const el of allLeafs) {
          const txt = el.textContent || '';
          const m = txt.match(/Beats\s*(\d+(?:\.\d+)?)\s*%/i);
          if (m) {
            const val = parseFloat(m[1]);
            const parentContext = (el.closest('div[class*="flex"], div[class*="container"]') || el.parentElement || {}).textContent || '';
            if (runtimePercentile == null && /Runtime/i.test(parentContext)) {
              runtimePercentile = val;
            } else if (memoryPercentile == null && /Memory/i.test(parentContext)) {
              memoryPercentile = val;
            } else if (runtimePercentile == null) {
              runtimePercentile = val;
            } else if (memoryPercentile == null) {
              memoryPercentile = val;
            }
          }
        }
      } catch (e) {}
    }

    return { runtime, runtimePercentile, memory, memoryPercentile };
  }

  /**
   * Extract problem title, number, slug, and canonical URL
   * @param {string|number} [knownQuestionId]
   * @returns {Promise<{ slug: string, title: string, number: string|null, url: string, difficulty: string, statement: string }|null>}
   */
  async function extractProblemMetadata(knownQuestionId) {
    const slug = getCurrentProblemSlug();
    if (!slug) return null;

    const canonicalUrl = `https://leetcode.com/problems/${slug}/`;
    let rawTitle = '';
    let problemNumber = knownQuestionId ? String(knownQuestionId) : null;
    let difficulty = null;
    let statementHtml = null;

    // 1. Try Next.js dehydrated state first - MUST match current slug
    const nextQuestion = getProblemDataFromNextData(slug);
    if (nextQuestion) {
      if (!problemNumber && nextQuestion.questionFrontendId) problemNumber = String(nextQuestion.questionFrontendId);
      if (nextQuestion.title) rawTitle = nextQuestion.title;
      if (nextQuestion.difficulty) difficulty = nextQuestion.difficulty;
      if (nextQuestion.content) statementHtml = nextQuestion.content;
    }

    // 2. If missing problemNumber or rawTitle or statementHtml, fetch from GraphQL
    if (!problemNumber || !rawTitle || !statementHtml || !difficulty) {
      const gqlQuestion = await fetchProblemDataFromGraphQL(slug);
      if (gqlQuestion) {
        if (!problemNumber && gqlQuestion.questionFrontendId) problemNumber = String(gqlQuestion.questionFrontendId);
        if (!rawTitle && gqlQuestion.title) rawTitle = gqlQuestion.title;
        if (!difficulty && gqlQuestion.difficulty) difficulty = gqlQuestion.difficulty;
        if (!statementHtml && gqlQuestion.content) statementHtml = gqlQuestion.content;
      }
    }

    // 3. Fallback to DOM title selectors if rawTitle still missing
    if (!rawTitle) {
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
    }

    let problemTitle = rawTitle;

    // Check if title starts with number prefix (e.g. "1. Two Sum" or "9. Palindrome Number")
    if (rawTitle) {
      const numMatch = rawTitle.match(/^(\d+)\.\s*(.+)$/);
      if (numMatch) {
        if (!problemNumber) problemNumber = numMatch[1];
        problemTitle = numMatch[2].trim();
      }
    }

    // Fallback: If title not found in DOM or API, format current slug to Title Case
    if (!problemTitle) {
      problemTitle = slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }

    // Known problem number fallbacks if still missing
    if (!problemNumber) {
      if (slug.toLowerCase() === 'two-sum') {
        problemNumber = '1';
      } else if (slug.toLowerCase() === 'palindrome-number') {
        problemNumber = '9';
      }
    }

    if (!difficulty) {
      difficulty = extractProblemDifficulty();
    }

    const statement = extractProblemStatement(statementHtml);

    return {
      slug,
      title: problemTitle,
      number: problemNumber,
      url: canonicalUrl,
      difficulty,
      statement
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
   * @param {string|number} [knownQuestionId]
   * @returns {Promise<object|null>}
   */
  async function captureSubmissionSnapshot(knownQuestionId) {
    const meta = await extractProblemMetadata(knownQuestionId);
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
      difficulty: meta.difficulty,
      statement: meta.statement,
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
    if (btn.getAttribute('data-cy') === 'submit-code-btn') return true;

    // Check visible text - MUST BE Submit, and NOT Run
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text.includes('run')) return false;
    if (text === 'submit' || text.startsWith('submit') || text.includes('submit')) return true;

    const title = (btn.getAttribute('title') || btn.getAttribute('aria-label') || '').toLowerCase();
    if (title.includes('submit')) return true;

    return false;
  }

  /**
   * Check if a DOM element is the Run Code button
   * @param {Element} element
   * @returns {boolean}
   */
  function isRunButton(element) {
    if (!element) return false;
    const btn = element.closest('button, [role="button"]');
    if (!btn) return false;

    if (btn.getAttribute('data-e2e-locator') === 'console-run-button') return true;
    if (btn.getAttribute('data-cypress') === 'run-code-btn') return true;

    const text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'run' || text === 'run code') return true;

    return false;
  }

  /**
   * Handle user initiating a submission
   */
  async function onSubmissionTriggered() {
    const slug = getCurrentProblemSlug();
    if (!slug) return;

    console.log('[AceLC Content] Submission action triggered on problem:', slug);

    // Snapshot immediately at submission time
    activeSubmissionSnapshot = await captureSubmissionSnapshot();

    // Start active DOM observer for judging result
    startResultObserver();
  }

  // Global event delegation for clicks (Submit vs Run)
  document.addEventListener('click', (event) => {
    if (isSubmitButton(event.target)) {
      onSubmissionTriggered();
    } else if (isRunButton(event.target)) {
      console.log('[AceLC Content] Run Code clicked. Modal will NOT be shown.');
      activeSubmissionSnapshot = null;
      stopResultObserver();
    }
  }, true);

  // Keyboard shortcut listener: Ctrl+Enter / Cmd+Enter or Ctrl+Alt+Enter
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
      isExplicitSubmitTriggered = true;
      // Only process on actual problem pages — skip submission detail/results pages
      const currentSlug = getCurrentProblemSlug();
      if (!currentSlug) {
        console.log('[AceLC Content] SUBMISSION_INITIATED ignored: not on a problem page.');
        return;
      }

      extractProblemMetadata(detail.questionId).then((meta) => {
        const rawLang = detail.language || detectLanguageFromDOM();
        const langInfo = typeof normalizeAceLanguage === 'function'
          ? normalizeAceLanguage(rawLang)
          : { id: rawLang, name: rawLang, ext: '.txt' };

        // Update active snapshot with exact submitted source code from HTTP payload
        activeSubmissionSnapshot = {
          problemTitle: meta ? meta.title : (detail.slug || ''),
          problemSlug: detail.slug || (meta ? meta.slug : currentSlug),
          problemUrl: meta ? meta.url : `https://leetcode.com/problems/${detail.slug || currentSlug}/`,
          problemNumber: (meta && meta.number) ? meta.number : (detail.questionId ? String(detail.questionId) : null),
          difficulty: meta ? meta.difficulty : 'Medium',
          statement: meta ? meta.statement : '',
          code: detail.code || (activeSubmissionSnapshot ? activeSubmissionSnapshot.code : ''),
          language: langInfo.name,
          languageId: langInfo.id,
          languageExt: langInfo.ext,
          submissionId: null,
          timestamp: detail.timestamp || Date.now()
        };

        startResultObserver();
      });
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
        runtimePercentile: detail.runtimePercentile,
        memoryPercentile: detail.memoryPercentile,
        questionId: detail.questionId,
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
        // Debounce slightly to allow network interception to deliver official metrics first
        setTimeout(() => {
          if (!activeSubmissionSnapshot) return;
          const domMetrics = extractMetricsFromDOM();

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
            runtime: domMetrics.runtime,
            memory: domMetrics.memory,
            runtimePercentile: domMetrics.runtimePercentile,
            memoryPercentile: domMetrics.memoryPercentile
          });
        }, 800);
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
      snapshot = await captureSubmissionSnapshot(resultDetails.questionId);
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

    // Fallback: If runtime or percentiles are missing and submissionId is available, fetch check details directly from LeetCode
    if (submissionId && (!resultDetails.runtime || resultDetails.runtimePercentile === null || resultDetails.memoryPercentile === null)) {
      try {
        const checkRes = await fetch(`/submissions/detail/${submissionId}/check/`);
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData && checkData.state === 'SUCCESS') {
            if (!resultDetails.runtime && checkData.status_runtime) {
              resultDetails.runtime = checkData.status_runtime;
            }
            if (!resultDetails.memory && checkData.status_memory) {
              resultDetails.memory = checkData.status_memory;
            }
            if (resultDetails.runtimePercentile === null && checkData.runtime_percentile !== undefined && checkData.runtime_percentile !== null) {
              resultDetails.runtimePercentile = checkData.runtime_percentile;
            }
            if (resultDetails.memoryPercentile === null && checkData.memory_percentile !== undefined && checkData.memory_percentile !== null) {
              resultDetails.memoryPercentile = checkData.memory_percentile;
            }
            if (!snapshot.problemNumber && checkData.question_id) {
              snapshot.problemNumber = String(checkData.question_id);
            }
          }
        }
      } catch (e) {
        console.warn('[AceLC Content] Could not fetch check details fallback:', e);
      }
    }

    // Check DOM metrics fallback if still missing
    if (!resultDetails.runtime || resultDetails.runtimePercentile === null) {
      const domM = extractMetricsFromDOM();
      if (!resultDetails.runtime && domM.runtime) resultDetails.runtime = domM.runtime;
      if (resultDetails.runtimePercentile === null && domM.runtimePercentile !== null) resultDetails.runtimePercentile = domM.runtimePercentile;
      if (!resultDetails.memory && domM.memory) resultDetails.memory = domM.memory;
      if (resultDetails.memoryPercentile === null && domM.memoryPercentile !== null) resultDetails.memoryPercentile = domM.memoryPercentile;
    }

    // Sanitize any extracted metrics to guarantee clean formatting
    if (resultDetails.runtime) {
      resultDetails.runtime = sanitizeMetric(resultDetails.runtime);
    }
    if (resultDetails.memory) {
      resultDetails.memory = sanitizeMetric(resultDetails.memory);
    }

    // Refresh problem number, difficulty or statement if missing or incomplete
    if (!snapshot.problemNumber || !snapshot.statement || snapshot.statement.length < 20 || snapshot.difficulty === 'Medium') {
      const refreshedMeta = await extractProblemMetadata(resultDetails.questionId);
      if (refreshedMeta) {
        if (!snapshot.problemNumber && refreshedMeta.number) snapshot.problemNumber = refreshedMeta.number;
        if ((!snapshot.statement || snapshot.statement.length < 20) && refreshedMeta.statement) snapshot.statement = refreshedMeta.statement;
        if (refreshedMeta.difficulty) snapshot.difficulty = refreshedMeta.difficulty;
        if (refreshedMeta.title) snapshot.problemTitle = refreshedMeta.title;
      }
    }

    // Double check problemTitle matches slug; if mismatched, format slug to Title Case
    if (snapshot.problemSlug && snapshot.problemTitle) {
      const slugWords = snapshot.problemSlug.toLowerCase().split('-');
      const titleWords = snapshot.problemTitle.toLowerCase().split(/\s+/);
      const hasOverlap = slugWords.some((w) => titleWords.includes(w));
      if (!hasOverlap) {
        snapshot.problemTitle = snapshot.problemSlug
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
      }
    }

    // Fallback for problem number if still missing
    if (!snapshot.problemNumber) {
      if (snapshot.problemSlug && snapshot.problemSlug.toLowerCase() === 'two-sum') {
        snapshot.problemNumber = '1';
      } else if (snapshot.problemSlug && snapshot.problemSlug.toLowerCase() === 'palindrome-number') {
        snapshot.problemNumber = '9';
      } else {
        const titleMatch = (snapshot.problemTitle || '').match(/^(\d+)\./);
        if (titleMatch) {
          snapshot.problemNumber = titleMatch[1];
        }
      }
    }

    const difficulty = snapshot.difficulty || extractProblemDifficulty();
    const statement = snapshot.statement || extractProblemStatement();

    // Build standard payload
    const submissionPayload = {
      problemTitle: snapshot.problemTitle,
      problemSlug: snapshot.problemSlug,
      problemUrl: snapshot.problemUrl,
      problemNumber: snapshot.problemNumber,
      difficulty: difficulty,
      statement: statement,
      code: snapshot.code,
      language: snapshot.language,
      languageId: snapshot.languageId,
      languageExt: snapshot.languageExt,
      submissionId: submissionId,
      runtime: resultDetails.runtime ? sanitizeMetric(resultDetails.runtime) : null,
      memory: resultDetails.memory ? sanitizeMetric(resultDetails.memory) : null,
      runtimePercentile: resultDetails.runtimePercentile || null,
      memoryPercentile: resultDetails.memoryPercentile || null,
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
        background: rgba(0, 0, 0, 0.75);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
        font-size: 13px;
        color: #ffffff;
      }
      #acelc-dest-modal {
        background: #1a1a1a;
        border-radius: 12px;
        width: 380px;
        max-width: 92vw;
        max-height: 90vh;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        padding: 16px;
        gap: 12px;
        border: 1px solid #333333;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8);
      }
      .acelc-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 6px;
      }
      .acelc-brand-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .acelc-brand-badge {
        background: #373737;
        color: #ffa116;
        border: 1px solid #484848;
        font-size: 9px;
        font-weight: 800;
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
      }
      .acelc-modal-title {
        font-size: 14px;
        font-weight: 800;
        color: #ffffff;
      }
      .acelc-close-btn {
        background: transparent;
        border: none;
        font-size: 16px;
        color: #a1a1aa;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .acelc-close-btn:hover {
        color: #ffffff;
        background: #2a2a2a;
      }
      .acelc-summary-card {
        background: #262626;
        border: 1px solid #383838;
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .acelc-problem-name {
        font-size: 13.5px;
        font-weight: 800;
        color: #ffffff;
      }
      .acelc-badge-row {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
      }
      .acelc-tag {
        font-size: 10.5px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 4px;
        background: #373737;
        color: #d4d4d8;
        border: 1px solid #484848;
      }
      .acelc-tag-lang {
        background: #373737;
        color: #ffa116;
      }
      .acelc-tag-success {
        background: #143521;
        color: #34d399;
      }
      .acelc-diff-easy {
        background: rgba(44, 187, 93, 0.15) !important;
        color: #2cbb5d !important;
        border: 1px solid rgba(44, 187, 93, 0.3) !important;
      }
      .acelc-diff-medium {
        background: rgba(255, 161, 22, 0.15) !important;
        color: #ffa116 !important;
        border: 1px solid rgba(255, 161, 22, 0.3) !important;
      }
      .acelc-diff-hard {
        background: rgba(239, 68, 68, 0.15) !important;
        color: #f87171 !important;
        border: 1px solid rgba(239, 68, 68, 0.3) !important;
      }
      .acelc-section-label {
        font-size: 10px;
        font-weight: 700;
        color: #a1a1aa;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 4px;
        display: block;
      }
      .acelc-repo-box {
        background: #262626;
        border: 1px solid #383838;
        border-radius: 8px;
        padding: 8px 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11.5px;
      }
      .acelc-repo-name {
        font-weight: 700;
        color: #ffffff;
      }
      .acelc-folders-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }
      .acelc-toggle-all-btn {
        background: transparent;
        border: none;
        color: #ffa116;
        font-size: 10.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .acelc-folders-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
        max-height: 140px;
        overflow-y: auto;
        border: 1px solid #383838;
        border-radius: 8px;
        padding: 8px;
        background: #262626;
      }
      .acelc-folder-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 8px;
        border-radius: 6px;
        cursor: pointer;
      }
      .acelc-folder-item:hover {
        background: #303030;
      }
      .acelc-folder-checkbox {
        accent-color: #ffa116;
        cursor: pointer;
      }
      .acelc-folder-label {
        font-size: 11.5px;
        font-weight: 500;
        color: #ffffff;
        cursor: pointer;
        flex: 1;
      }
      .acelc-actions-row {
        display: flex;
        gap: 8px;
        margin-top: 4px;
      }
      .acelc-btn-push {
        flex: 1;
        background: #282828;
        color: #2cbb5d;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        transition: all 0.15s ease;
      }
      .acelc-btn-push:hover:not(:disabled) {
        background: #363636;
        border-color: rgba(255, 255, 255, 0.16);
      }
      .acelc-btn-push:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .acelc-btn-confirm {
        flex: 1;
        background: #ffa116;
        color: #1a1a1a;
        border: none;
        border-radius: 8px;
        padding: 8px 16px;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.15s ease;
      }
      .acelc-btn-confirm:hover:not(:disabled) {
        background: #ffb33e;
      }
      .acelc-btn-confirm:disabled {
        background: #373737;
        color: #71717a;
        border: 1px solid #484848;
        cursor: not-allowed;
      }
      .acelc-btn-cancel {
        background: #373737;
        color: #ffffff;
        border: 1px solid #484848;
        border-radius: 8px;
        padding: 8px 14px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .acelc-btn-cancel:hover {
        background: #444444;
      }
      .acelc-result-card {
        background: #262626;
        border: 1px solid #383838;
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .acelc-result-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(44, 187, 93, 0.15);
        color: #2cbb5d;
        border: 1px solid rgba(44, 187, 93, 0.3);
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 11.5px;
        font-weight: 700;
        align-self: flex-start;
      }
      .acelc-result-links-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 2px;
      }
      .acelc-result-file-link {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        background: #1e1e1e;
        border: 1px solid #383838;
        border-radius: 8px;
        padding: 9px 12px;
        color: #e4e4e7;
        text-decoration: none;
        font-size: 11.5px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        transition: all 0.15s ease;
      }
      .acelc-result-file-link:hover {
        background: #2d2d2d;
        border-color: #52525b;
        color: #ffffff;
      }
      .acelc-result-action-pill {
        font-size: 10px;
        font-weight: 700;
        color: #ffa116;
        background: #373737;
        padding: 3px 8px;
        border-radius: 4px;
        border: 1px solid #484848;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
      }
      .acelc-success-banner {
        background: #143521;
        border: 1px solid #166534;
        color: #a7f3d0;
        border-radius: 8px;
        padding: 10px;
        text-align: center;
        font-weight: 700;
        font-size: 12px;
      }
      @keyframes acelc-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  /**
   * Retrieve the exact submit icon SVG matching LeetCode's native Submit button
   * Clones directly from LeetCode's DOM if present, with a precise vector fallback.
   * @returns {string} SVG HTML string
   */
  function getLeetCodeSubmitIconSvg() {
    try {
      const nativeSubmitBtn = document.querySelector('[data-e2e-locator="console-submit-button"], button[data-cypress="submit-code-btn"], button[data-cy="submit-code-btn"]');
      if (nativeSubmitBtn) {
        const svg = nativeSubmitBtn.querySelector('svg');
        if (svg) {
          const clone = svg.cloneNode(true);
          clone.setAttribute('width', '16');
          clone.setAttribute('height', '16');
          clone.style.stroke = '#2cbb5d';
          clone.style.color = '#2cbb5d';
          clone.style.fill = 'none';
          clone.style.display = 'inline-block';
          clone.style.verticalAlign = 'middle';
          return clone.outerHTML;
        }
      }
    } catch (e) {}

    // Precise fallback vector replicating LeetCode's native cloud upload icon
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2cbb5d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 18h12a4 4 0 0 0 1-7.87 5.5 5.5 0 0 0-10.7-1.4A4 4 0 0 0 6 18z"/>
      <path d="M12 16V10"/>
      <path d="m9.5 12.5 2.5-2.5 2.5 2.5"/>
    </svg>`;
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

    const diffTag = document.createElement('span');
    diffTag.className = 'acelc-tag';
    const diff = (submission.difficulty || 'Medium').toLowerCase();
    diffTag.textContent = submission.difficulty || 'Medium';
    if (diff === 'easy') {
      diffTag.className += ' acelc-diff-easy';
    } else if (diff === 'hard') {
      diffTag.className += ' acelc-diff-hard';
    } else {
      diffTag.className += ' acelc-diff-medium';
    }

    badgeRow.appendChild(langTag);
    badgeRow.appendChild(statusTag);
    badgeRow.appendChild(diffTag);

    function formatMetricWithPercentile(value, percentile) {
      if (!value) return null;
      let valStr = String(value).replace(/beats\s*/gi, '').trim();
      if (percentile !== null && percentile !== undefined && String(percentile).trim().length > 0) {
        let cleanPct = String(percentile).replace(/beats\s*/gi, '').replace('%', '').trim();
        const num = parseFloat(cleanPct);
        if (!isNaN(num) && num > 0) {
          if (!valStr.includes('%')) {
            return `${valStr} (${num.toFixed(1)}%)`;
          }
        }
      }
      return valStr;
    }

    if (submission.runtime) {
      const runtimeTag = document.createElement('span');
      runtimeTag.className = 'acelc-tag';
      runtimeTag.textContent = formatMetricWithPercentile(submission.runtime, submission.runtimePercentile);
      badgeRow.appendChild(runtimeTag);
    }

    if (submission.memory) {
      const memoryTag = document.createElement('span');
      memoryTag.className = 'acelc-tag';
      memoryTag.textContent = formatMetricWithPercentile(submission.memory, submission.memoryPercentile);
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
    toggleAllBtn.textContent = 'Select All';

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
        cb.checked = false;

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

    // Toggle All functionality (unchecked by default)
    let allSelected = false;
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

    const submitIconSvg = getLeetCodeSubmitIconSvg();

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'acelc-btn-push';
    confirmBtn.type = 'button';
    confirmBtn.title = 'Push solution to GitHub';
    confirmBtn.innerHTML = `
      ${submitIconSvg}
      <span>Push</span>
    `;

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
      confirmBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2cbb5d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="animation: acelc-spin 1s linear infinite;">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10"></path>
        </svg>
        <span>Pushing...</span>
      `;

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
            // Phase 7: Trigger upload immediately after confirmation
            confirmBtn.innerHTML = `
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2cbb5d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="animation: acelc-spin 1s linear infinite;">
                <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
                <path d="M12 2a10 10 0 0 1 10 10"></path>
              </svg>
              <span>Pushing...</span>
            `;
            triggerModalUpload(response.confirmedSubmission, modal, overlay, {});
          } else {
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            confirmBtn.innerHTML = `
              ${submitIconSvg}
              <span>Push</span>
            `;
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

  /**
   * Trigger solution upload from the in-page modal and render the result.
   * Handles overwrite confirmation inline with new buttons in the modal.
   * @param {object|null} confirmedRecord
   * @param {HTMLElement} modal
   * @param {HTMLElement} overlay
   * @param {object} overwriteDecisions
   */
  function triggerModalUpload(confirmedRecord, modal, overlay, overwriteDecisions) {
    if (!confirmedRecord) {
      // Fall back — no confirmed record returned; just show queued message
      modal.innerHTML = `<div class="acelc-success-banner">✓ Solution queued for upload.</div>`;
      setTimeout(() => overlay.remove(), 1400);
      return;
    }

    safeSendMessage(
      {
        action: Constants.MESSAGES.UPLOAD_SOLUTION,
        payload: {
          submissionUid: confirmedRecord.uid,
          overwriteDecisions: overwriteDecisions || {}
        }
      },
      (response) => {
        if (!response) {
          modal.innerHTML = `<div class="acelc-success-banner" style="background:#fef2f2;border-color:#fecaca;color:#b91c1c;">❌ Upload failed: could not reach background worker.</div>`;
          setTimeout(() => overlay.remove(), 2500);
          return;
        }

        // Some folders need overwrite confirmation
        if (response.needsOverwriteConfirmation && Array.isArray(response.results)) {
          const conflicting = response.results.filter((r) => r.needsOverwriteConfirmation);
          renderModalOverwritePrompt(modal, overlay, confirmedRecord, conflicting, overwriteDecisions);
          return;
        }

        // Render upload results
        renderModalUploadResults(modal, overlay, response);
      }
    );
  }

  /**
   * Render overwrite confirmation buttons inside the in-page modal.
   */
  function renderModalOverwritePrompt(modal, overlay, confirmedRecord, conflicting, existingDecisions) {
    modal.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'acelc-modal-header';
    const brandBadge = document.createElement('span');
    brandBadge.className = 'acelc-brand-badge';
    brandBadge.textContent = 'AceLC';
    const title = document.createElement('span');
    title.className = 'acelc-modal-title';
    title.textContent = 'File Already Exists';
    header.appendChild(brandBadge);
    header.appendChild(title);
    modal.appendChild(header);

    const intro = document.createElement('div');
    intro.style.cssText = 'font-size:12px;color:#ffa116;background:rgba(255,161,22,0.12);border:1px solid rgba(255,161,22,0.3);border-radius:6px;padding:8px;margin-bottom:6px;';
    intro.textContent = `${conflicting.length} file(s) already exist in GitHub. Choose what to do:`;
    modal.appendChild(intro);

    const decisions = { ...existingDecisions };
    let resolvedCount = 0;

    for (const item of conflicting) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px;background:#262626;border:1px solid #383838;border-radius:8px;margin-bottom:6px;';

      const pathEl = document.createElement('div');
      pathEl.style.cssText = 'font-size:11.5px;color:#e4e4e7;word-break:break-all;font-weight:600;font-family:ui-monospace,monospace;';
      pathEl.textContent = item.filePath;

      const btnsRow = document.createElement('div');
      btnsRow.style.cssText = 'display:flex;gap:6px;';

      const overwriteBtn = document.createElement('button');
      overwriteBtn.className = 'acelc-btn-confirm';
      overwriteBtn.style.cssText = 'flex:1;font-size:12px;padding:6px;background:#dc2626;color:#ffffff;';
      overwriteBtn.textContent = '✏️ Overwrite';

      const skipBtn = document.createElement('button');
      skipBtn.className = 'acelc-btn-cancel';
      skipBtn.style.cssText = 'font-size:12px;padding:6px;';
      skipBtn.textContent = '⏭️ Skip';

      function handleDecision(folder, decision) {
        decisions[folder] = decision;
        overwriteBtn.disabled = true;
        skipBtn.disabled = true;
        pathEl.textContent = `${item.filePath} → ${decision === 'overwrite' ? '✏️ Overwrite' : '⏭️ Skip'}`;
        resolvedCount += 1;
        if (resolvedCount === conflicting.length) {
          modal.innerHTML = '';
          const uploadingMsg = document.createElement('div');
          uploadingMsg.className = 'acelc-success-banner';
          uploadingMsg.textContent = 'Uploading...';
          modal.appendChild(uploadingMsg);
          triggerModalUpload(confirmedRecord, modal, overlay, decisions);
        }
      }

      overwriteBtn.onclick = () => handleDecision(item.folder, 'overwrite');
      skipBtn.onclick = () => handleDecision(item.folder, 'skip');

      btnsRow.appendChild(overwriteBtn);
      btnsRow.appendChild(skipBtn);
      row.appendChild(pathEl);
      row.appendChild(btnsRow);
      modal.appendChild(row);
    }
  }

  /**
   * Render upload results summary inside the in-page modal.
   */
  function renderModalUploadResults(modal, overlay, response) {
    modal.innerHTML = '';

    const results = Array.isArray(response.results) ? response.results : [];
    const created = results.filter((r) => r.success && !r.skipped && !r.overwritten);
    const overwritten = results.filter((r) => r.success && r.overwritten);
    const skipped = results.filter((r) => r.success && r.skipped);
    const failed = results.filter((r) => !r.success && !r.needsOverwriteConfirmation);

    const hasSuccess = created.length + overwritten.length > 0;
    const hasFailure = failed.length > 0;

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
    modalTitle.textContent = hasSuccess ? 'Saved to GitHub! 🚀' : 'Upload Status';

    brandRow.appendChild(brandBadge);
    brandRow.appendChild(modalTitle);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'acelc-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close';
    closeBtn.onclick = () => overlay.remove();

    header.appendChild(brandRow);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Result Card
    const resultCard = document.createElement('div');
    resultCard.className = 'acelc-result-card';

    if (hasSuccess) {
      const statusPill = document.createElement('div');
      statusPill.className = 'acelc-result-status-pill';
      statusPill.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2cbb5d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Upload Successful</span>
      `;
      resultCard.appendChild(statusPill);

      const fileNameLabel = document.createElement('div');
      fileNameLabel.style.cssText = 'font-size: 13px; font-weight: 700; color: #ffffff;';
      fileNameLabel.textContent = response.filename ? `Solution ${response.filename} saved to GitHub` : 'Solution saved to GitHub.';
      resultCard.appendChild(fileNameLabel);

      const linksList = document.createElement('div');
      linksList.className = 'acelc-result-links-list';

      for (const r of [...created, ...overwritten]) {
        const link = document.createElement('a');
        link.href = r.url || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'acelc-result-file-link';
        link.innerHTML = `
          <span style="display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffa116" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span style="overflow:hidden;text-overflow:ellipsis;">${r.filePath}</span>
          </span>
          <span class="acelc-result-action-pill">View ↗</span>
        `;
        linksList.appendChild(link);
      }

      resultCard.appendChild(linksList);
    }

    for (const r of skipped) {
      const skippedNote = document.createElement('div');
      skippedNote.style.cssText = 'font-size: 11px; color: #a1a1aa; background: #1e1e1e; border: 1px solid #383838; border-radius: 6px; padding: 6px 10px;';
      skippedNote.textContent = `⏭️ Skipped (already exists): ${r.filePath}`;
      resultCard.appendChild(skippedNote);
    }

    for (const r of failed) {
      const failedNote = document.createElement('div');
      failedNote.style.cssText = 'font-size: 11px; color: #f87171; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 6px 10px;';
      failedNote.textContent = `❌ ${r.filePath}: ${r.error || 'Upload failed.'}`;
      resultCard.appendChild(failedNote);
    }

    modal.appendChild(resultCard);

    // Done Button
    const doneBtn = document.createElement('button');
    doneBtn.className = 'acelc-btn-cancel';
    doneBtn.textContent = 'Done';
    doneBtn.style.cssText = 'width: 100%; margin-top: 4px; padding: 9px; font-weight: 700; font-size: 12px;';
    doneBtn.onclick = () => overlay.remove();
    modal.appendChild(doneBtn);

    // Auto-dismiss after 6 seconds if completely successful
    if (hasSuccess && !hasFailure) {
      setTimeout(() => {
        if (document.body.contains(overlay)) {
          overlay.remove();
        }
      }, 6000);
    }
  }

  // Listen for background worker messages to show destination modal
  // Wrapped in try/catch: if the extension is reloaded while the page is open,
  // chrome.runtime becomes invalid and addListener would throw synchronously.
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!isExtensionValid()) return;
      if (message && message.action === Constants.MESSAGES.SHOW_DESTINATION_MODAL) {
        try {
          console.log('[AceLC Content] Received SHOW_DESTINATION_MODAL for problem:', message.submission.problemSlug);
          showDestinationModal(message.submission, message.repository, message.folders);
          sendResponse({ success: true, shown: true });
        } catch (e) {
          console.warn('[AceLC Content] Error showing destination modal:', e.message);
        }
        return false;
      }
    });
  } catch (e) {
    console.warn('[AceLC Content] Could not register message listener (extension context invalidated). Refresh the page to re-enable AceLC.');
  }

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
