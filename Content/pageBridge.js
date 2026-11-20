/**
 * AceLC - LeetCode Page Bridge (Main World)
 * Executes in the webpage's main JavaScript context.
 * Intercepts network submissions, monitors judging status,
 * and provides direct access to the Monaco code editor.
 */

(() => {
  // Prevent duplicate bridge initialization
  if (window.__ACE_PAGE_BRIDGE_INITIALIZED__) {
    return;
  }
  window.__ACE_PAGE_BRIDGE_INITIALIZED__ = true;

  console.log('[AceLC Bridge] Page bridge initialized in main world context.');

  const BRIDGE_EVENTS = {
    SUBMISSION_INITIATED: 'ACE_BRIDGE_SUBMISSION_INITIATED',
    SUBMISSION_ID_ASSIGNED: 'ACE_BRIDGE_SUBMISSION_ID_ASSIGNED',
    SUBMISSION_PENDING: 'ACE_BRIDGE_SUBMISSION_PENDING',
    SUBMISSION_ACCEPTED: 'ACE_BRIDGE_SUBMISSION_ACCEPTED',
    SUBMISSION_FAILED: 'ACE_BRIDGE_SUBMISSION_FAILED',
    REQUEST_MONACO_CODE: 'ACE_BRIDGE_REQUEST_MONACO_CODE',
    RESPONSE_MONACO_CODE: 'ACE_BRIDGE_RESPONSE_MONACO_CODE',
    URL_CHANGED: 'ACE_BRIDGE_URL_CHANGED'
  };

  /**
   * Safe event dispatcher that triggers both CustomEvent and window.postMessage
   * @param {string} type 
   * @param {object} detail 
   */
  function dispatchBridgeEvent(type, detail) {
    try {
      // 1. Dispatch custom DOM event
      window.dispatchEvent(new CustomEvent(type, { detail }));
    } catch (err) {
      // Ignore DOM dispatch error
    }

    try {
      // 2. Post window message for reliable cross-world delivery
      window.postMessage({ source: 'ACELC_PAGE_BRIDGE', type, detail }, '*');
    } catch (err) {
      // Ignore message error
    }
  }

  // =========================================================================
  // 1. MONACO EDITOR DIRECT ACCESS
  // =========================================================================

  /**
   * Read source code and language directly from Monaco Editor instances
   * @returns {{ code: string|null, language: string|null }}
   */
  function readFromMonaco() {
    try {
      if (typeof window.monaco === 'undefined' || !window.monaco.editor) {
        return { code: null, language: null };
      }

      const editors = window.monaco.editor.getEditors();
      if (!Array.isArray(editors) || editors.length === 0) {
        return { code: null, language: null };
      }

      // The main workspace editor is almost always index 0
      const editor = editors[0];
      const model = editor.getModel();

      const code = typeof editor.getValue === 'function' ? editor.getValue() : null;
      const language = model && typeof model.getLanguageId === 'function' ? model.getLanguageId() : null;

      return { code, language };
    } catch (err) {
      console.warn('[AceLC Bridge] Failed reading from Monaco editor:', err);
      return { code: null, language: null };
    }
  }

  // Handle on-demand code extraction requests from content script
  window.addEventListener(BRIDGE_EVENTS.REQUEST_MONACO_CODE, (event) => {
    const requestId = event && event.detail ? event.detail.requestId : null;
    const { code, language } = readFromMonaco();
    dispatchBridgeEvent(BRIDGE_EVENTS.RESPONSE_MONACO_CODE, {
      requestId,
      code,
      language
    });
  });

  // =========================================================================
  // 2. NETWORK SUBMISSION INTERCEPTION (FETCH & XHR)
  // =========================================================================

  const SUBMIT_URL_REGEX = /\/problems\/([^/]+)\/submit\/?/i;
  const CHECK_URL_REGEX = /\/submissions\/detail\/([^/]+)\/check\/?/i;

  /**
   * Parse submission payload from request body
   * @param {any} body 
   */
  function parseSubmissionBody(body) {
    if (!body) return null;
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      if (data && typeof data === 'object') {
        return {
          code: data.typed_code || data.typedCode || null,
          lang: data.lang || null,
          questionId: data.question_id || data.questionId || null
        };
      }
    } catch (e) {
      // Not JSON
    }
    return null;
  }

  /**
   * Process submission initiation
   */
  function handleSubmissionInitiated(slug, parsedBody) {
    if (!parsedBody || !parsedBody.code) {
      // Fallback: try capturing directly from Monaco at submit time
      const monacoData = readFromMonaco();
      if (monacoData.code) {
        parsedBody = parsedBody || {};
        parsedBody.code = monacoData.code;
        parsedBody.lang = parsedBody.lang || monacoData.language;
      }
    }

    if (!parsedBody || !parsedBody.code) return;

    dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_INITIATED, {
      slug: slug || '',
      code: parsedBody.code,
      language: parsedBody.lang || '',
      questionId: parsedBody.questionId || null,
      timestamp: Date.now()
    });
  }

  /**
   * Process judging response data
   */
  function handleJudgingResult(submissionId, data) {
    if (!data || typeof data !== 'object') return;

    const state = data.state;
    const statusMsg = data.status_msg || data.statusDisplay || '';
    const statusCode = data.status_code;
    const runSuccess = Boolean(data.run_success || data.runSuccess);

    // 1. Pending or in-progress evaluation
    if (state === 'PENDING' || state === 'STARTED') {
      dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_PENDING, {
        submissionId: String(submissionId),
        timestamp: Date.now()
      });
      return;
    }

    // 2. Terminal state: check if Accepted
    const isAccepted =
      statusMsg.toLowerCase() === 'accepted' ||
      statusCode === 10 ||
      (state === 'SUCCESS' && runSuccess && statusMsg.toLowerCase() === 'accepted');

    if (isAccepted) {
      dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_ACCEPTED, {
        submissionId: String(data.submission_id || submissionId),
        statusMsg: 'Accepted',
        runtime: data.status_runtime || data.runtime || null,
        memory: data.status_memory || data.memory || null,
        totalCorrect: data.total_correct ?? data.totalCorrect ?? null,
        totalTestcases: data.total_testcases ?? data.totalTestcases ?? null,
        timestamp: Date.now()
      });
    } else if (state === 'SUCCESS' || statusMsg) {
      // Submission evaluated, but failed or rejected (Wrong Answer, TLE, etc.)
      dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_FAILED, {
        submissionId: String(data.submission_id || submissionId),
        statusMsg: statusMsg || 'Not Accepted',
        timestamp: Date.now()
      });
    }
  }

  // ---- Fetch Interception ----
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    let url = '';
    let options = args[1] || {};

    if (typeof args[0] === 'string') {
      url = args[0];
    } else if (args[0] && typeof args[0].url === 'string') {
      url = args[0].url;
      if (!options.method && args[0].method) {
        options.method = args[0].method;
      }
    }

    const method = (options.method || 'GET').toUpperCase();

    // Check for REST submission POST
    const submitMatch = url.match(SUBMIT_URL_REGEX);
    if (submitMatch && method === 'POST') {
      const slug = submitMatch[1];
      const parsedBody = parseSubmissionBody(options.body);
      handleSubmissionInitiated(slug, parsedBody);
    }

    // Execute original fetch
    let response;
    try {
      response = await originalFetch.apply(this, args);
    } catch (fetchErr) {
      throw fetchErr;
    }

    // Inspect submit response to extract submission ID
    if (submitMatch && method === 'POST' && response.ok) {
      try {
        const clone = response.clone();
        clone.json().then((data) => {
          if (data && (data.submission_id || data.interpret_id)) {
            dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_ID_ASSIGNED, {
              submissionId: String(data.submission_id || data.interpret_id),
              timestamp: Date.now()
            });
          }
        }).catch(() => {});
      } catch (e) {}
    }

    // Inspect check response for judging status
    const checkMatch = url.match(CHECK_URL_REGEX);
    if (checkMatch && response.ok) {
      try {
        const clone = response.clone();
        clone.json().then((data) => {
          handleJudgingResult(checkMatch[1], data);
        }).catch(() => {});
      } catch (e) {}
    }

    // Check for GraphQL submission or check
    if (url.includes('/graphql') && method === 'POST') {
      try {
        const bodyObj = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
        const query = (bodyObj && bodyObj.query) ? bodyObj.query : '';
        const variables = (bodyObj && bodyObj.variables) ? bodyObj.variables : {};

        // GraphQL submit mutation
        if (query.includes('submitCode') && variables.typedCode) {
          handleSubmissionInitiated(variables.questionSlug || '', {
            code: variables.typedCode,
            lang: variables.lang,
            questionId: variables.questionId
          });
        }

        // Intercept GraphQL response
        if (query.includes('submitCode') || query.includes('submissionDetails') || query.includes('submissionCheck')) {
          const clone = response.clone();
          clone.json().then((resData) => {
            if (resData && resData.data) {
              if (resData.data.submitCode && resData.data.submitCode.submissionId) {
                dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_ID_ASSIGNED, {
                  submissionId: String(resData.data.submitCode.submissionId),
                  timestamp: Date.now()
                });
              }
              if (resData.data.submissionDetails) {
                const details = resData.data.submissionDetails;
                handleJudgingResult(details.id || details.submissionId, details);
              }
            }
          }).catch(() => {});
        }
      } catch (e) {}
    }

    return response;
  };

  // ---- XHR Interception ----
  try {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__ace_url = url;
      this.__ace_method = (method || 'GET').toUpperCase();
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (body) {
      const url = this.__ace_url || '';
      const method = this.__ace_method || 'GET';

      const submitMatch = url.match(SUBMIT_URL_REGEX);
      if (submitMatch && method === 'POST') {
        const parsedBody = parseSubmissionBody(body);
        handleSubmissionInitiated(submitMatch[1], parsedBody);
      }

      this.addEventListener('load', () => {
        try {
          if (this.status >= 200 && this.status < 300) {
            const data = JSON.parse(this.responseText);
            if (submitMatch && (data.submission_id || data.interpret_id)) {
              dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_ID_ASSIGNED, {
                submissionId: String(data.submission_id || data.interpret_id),
                timestamp: Date.now()
              });
            }

            const checkMatch = url.match(CHECK_URL_REGEX);
            if (checkMatch) {
              handleJudgingResult(checkMatch[1], data);
            }
          }
        } catch (e) {}
      });

      return originalSend.apply(this, [body]);
    };
  } catch (err) {
    console.warn('[AceLC Bridge] Failed setting up XHR interception:', err);
  }

  // =========================================================================
  // 3. SPA ROUTING & URL NAVIGATION MONITOR
  // =========================================================================

  function notifyUrlChange() {
    dispatchBridgeEvent(BRIDGE_EVENTS.URL_CHANGED, {
      url: window.location.href,
      pathname: window.location.pathname
    });
  }

  try {
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      notifyUrlChange();
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      notifyUrlChange();
      return result;
    };

    window.addEventListener('popstate', notifyUrlChange);
  } catch (err) {
    console.warn('[AceLC Bridge] Failed hooking history API:', err);
  }
})();
