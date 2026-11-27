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

      let bestCode = null;
      let bestLang = null;
      let maxLen = 0;

      // 1. Inspect all active editor instances
      const editors = window.monaco.editor.getEditors();
      if (Array.isArray(editors) && editors.length > 0) {
        for (const editor of editors) {
          try {
            if (typeof editor.getValue === 'function') {
              const val = editor.getValue();
              if (val && val.trim().length > maxLen) {
                maxLen = val.trim().length;
                bestCode = val;
                const model = editor.getModel();
                if (model && typeof model.getLanguageId === 'function') {
                  bestLang = model.getLanguageId();
                }
              }
            }
          } catch (e) {}
        }
      }

      // 2. Inspect all text models directly as fallback
      if (!bestCode && typeof window.monaco.editor.getModels === 'function') {
        const models = window.monaco.editor.getModels();
        if (Array.isArray(models) && models.length > 0) {
          for (const model of models) {
            try {
              if (typeof model.getValue === 'function') {
                const val = model.getValue();
                if (val && val.trim().length > maxLen) {
                  maxLen = val.trim().length;
                  bestCode = val;
                  if (typeof model.getLanguageId === 'function') {
                    bestLang = model.getLanguageId();
                  }
                }
              }
            } catch (e) {}
          }
        }
      }

      return { code: bestCode, language: bestLang };
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

  // Track explicit submit submission IDs to strictly ignore testcase "Run Code" checks
  const activeSubmittedIds = new Set();

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

    const subIdStr = String(submissionId);

    // If active submissions are being tracked, ignore any judging check for Run Code (interpret tasks)
    if (activeSubmittedIds.size > 0 && !activeSubmittedIds.has(subIdStr)) {
      return;
    }

    // Ignore if this is explicitly a Run Code interpret response
    if (data.interpret_id || data.interpret_status_code || data.test_case) {
      return;
    }

    const state = data.state;
    const statusMsg = data.status_msg || data.statusDisplay || '';
    const statusCode = data.status_code ?? data.statusCode;
    const runSuccess = Boolean(data.run_success || data.runSuccess);

    // 1. Pending or in-progress evaluation
    if (state === 'PENDING' || state === 'STARTED') {
      dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_PENDING, {
        submissionId: subIdStr,
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
      // Remove from active tracking once processed
      activeSubmittedIds.delete(subIdStr);

      let runtime = data.status_runtime || data.runtimeDisplay || data.runtime_display || null;
      if (!runtime && data.runtime !== undefined && data.runtime !== null) {
        runtime = typeof data.runtime === 'number' ? `${data.runtime} ms` : String(data.runtime);
      }

      let memory = data.status_memory || data.memoryDisplay || data.memory_display || null;
      if (!memory && data.memory !== undefined && data.memory !== null) {
        if (typeof data.memory === 'number' && data.memory > 1000000) {
          memory = `${(data.memory / (1024 * 1024)).toFixed(1)} MB`;
        } else {
          memory = String(data.memory);
        }
      }

      const runtimePercentile = data.runtime_percentile ?? data.runtimePercentile ?? null;
      const memoryPercentile = data.memory_percentile ?? data.memoryPercentile ?? null;
      const questionId = data.question_id || data.questionId || (data.question && (data.question.questionFrontendId || data.question.questionId)) || null;

      dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_ACCEPTED, {
        submissionId: String(data.submission_id || data.id || subIdStr),
        statusMsg: 'Accepted',
        runtime,
        memory,
        runtimePercentile,
        memoryPercentile,
        questionId,
        totalCorrect: data.total_correct ?? data.totalCorrect ?? null,
        totalTestcases: data.total_testcases ?? data.totalTestcases ?? null,
        timestamp: Date.now()
      });
    } else if (state === 'SUCCESS' || statusMsg) {
      activeSubmittedIds.delete(subIdStr);
      // Submission evaluated, but failed or rejected (Wrong Answer, TLE, etc.)
      dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_FAILED, {
        submissionId: String(data.submission_id || data.id || subIdStr),
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
          if (data && data.submission_id) {
            const subIdStr = String(data.submission_id);
            activeSubmittedIds.add(subIdStr);
            dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_ID_ASSIGNED, {
              submissionId: subIdStr,
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
        const isGraphQLSubmission = query.includes('submitCode') ||
          query.includes('submissionDetails') ||
          query.includes('submissionDetail') ||
          query.includes('submissionCheck') ||
          query.includes('submissionStatus');

        if (isGraphQLSubmission) {
          const clone = response.clone();
          clone.json().then((resData) => {
            if (resData && resData.data) {
              if (resData.data.submitCode && resData.data.submitCode.submissionId) {
                const subIdStr = String(resData.data.submitCode.submissionId);
                activeSubmittedIds.add(subIdStr);
                dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_ID_ASSIGNED, {
                  submissionId: subIdStr,
                  timestamp: Date.now()
                });
              }
              const details = resData.data.submissionDetails || resData.data.submissionDetail;
              if (details) {
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
            if (submitMatch && data.submission_id) {
              const subIdStr = String(data.submission_id);
              activeSubmittedIds.add(subIdStr);
              dispatchBridgeEvent(BRIDGE_EVENTS.SUBMISSION_ID_ASSIGNED, {
                submissionId: subIdStr,
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
