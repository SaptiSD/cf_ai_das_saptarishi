/**
 * Returns the full HTML for the chat UI.
 *
 * The UI communicates with the Worker via:
 *   POST /api/chat         – send a message (SSE streaming response)
 *   GET  /api/history      – load conversation history
 *   DELETE /api/history    – clear the conversation
 *
 * A unique session ID (UUID v4) is generated per browser tab and stored in
 * sessionStorage so that each tab has its own isolated conversation context.
 */
export function getUIHTML(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CF AI Assistant – Llama 3.3</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #0f1117;
      --surface:   #1a1d27;
      --border:    #2a2d3e;
      --accent:    #f97316;
      --accent-dk: #c2410c;
      --text:      #e2e8f0;
      --text-muted:#94a3b8;
      --user-bg:   #1e3a5f;
      --ai-bg:     #1a1d27;
      --radius:    12px;
    }

    html, body { height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

    /* ── Layout ──────────────────────────────────────── */
    #app {
      display: flex;
      flex-direction: column;
      height: 100vh;
      max-width: 820px;
      margin: 0 auto;
    }

    /* ── Header ─────────────────────────────────────── */
    header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--surface);
    }
    header .logo { font-size: 28px; }
    header h1 { font-size: 18px; font-weight: 700; }
    header p  { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    #clear-btn {
      margin-left: auto;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      transition: border-color .2s, color .2s;
    }
    #clear-btn:hover { border-color: var(--accent); color: var(--accent); }

    /* ── Messages ────────────────────────────────────── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      scroll-behavior: smooth;
    }

    .msg {
      display: flex;
      gap: 10px;
      max-width: 85%;
      animation: fadeIn .25s ease;
    }
    .msg.user  { align-self: flex-end; flex-direction: row-reverse; }
    .msg.ai    { align-self: flex-start; }

    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
      background: var(--border);
    }
    .msg.user .avatar { background: var(--accent); }

    .bubble {
      padding: 12px 16px;
      border-radius: var(--radius);
      line-height: 1.6;
      font-size: 14px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg.user .bubble { background: var(--user-bg); border-top-right-radius: 4px; }
    .msg.ai   .bubble { background: var(--ai-bg); border: 1px solid var(--border); border-top-left-radius: 4px; }

    /* typing dots */
    .typing { display: flex; gap: 4px; align-items: center; padding: 14px 18px; }
    .typing span {
      width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted);
      animation: bounce .9s infinite;
    }
    .typing span:nth-child(2) { animation-delay: .15s; }
    .typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

    /* empty state */
    #empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--text-muted);
      text-align: center;
      padding: 40px;
    }
    #empty .big { font-size: 48px; }
    #empty h2 { font-size: 18px; color: var(--text); }
    #empty p  { font-size: 14px; max-width: 360px; }

    /* ── Input area ──────────────────────────────────── */
    #input-area {
      padding: 16px 20px;
      border-top: 1px solid var(--border);
      background: var(--surface);
      display: flex;
      gap: 10px;
      align-items: flex-end;
    }
    #input {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: var(--radius);
      padding: 12px 16px;
      font-size: 14px;
      line-height: 1.5;
      resize: none;
      min-height: 46px;
      max-height: 160px;
      overflow-y: auto;
      outline: none;
      transition: border-color .2s;
    }
    #input:focus { border-color: var(--accent); }
    #input::placeholder { color: var(--text-muted); }

    #send-btn {
      background: var(--accent);
      border: none;
      color: #fff;
      padding: 12px 20px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      height: 46px;
      transition: background .2s, opacity .2s;
      white-space: nowrap;
    }
    #send-btn:hover:not(:disabled) { background: var(--accent-dk); }
    #send-btn:disabled { opacity: .5; cursor: not-allowed; }

    /* error toast */
    #toast {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: #7f1d1d;
      color: #fca5a5;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      display: none;
      max-width: 340px;
      text-align: center;
    }
    #toast.show { display: block; }
  </style>
</head>
<body>
<div id="app">
  <header>
    <span class="logo">🤖</span>
    <div>
      <h1>CF AI Assistant</h1>
      <p>Powered by Llama 3.3 · Cloudflare Workers AI</p>
    </div>
    <button id="clear-btn" title="Clear conversation">🗑 Clear</button>
  </header>

  <div id="messages">
    <div id="empty">
      <div class="big">💬</div>
      <h2>Start a conversation</h2>
      <p>Ask me anything — I'm running on Llama 3.3 70B via Cloudflare Workers AI with persistent memory.</p>
    </div>
  </div>

  <div id="input-area">
    <textarea id="input" placeholder="Type a message… (Enter to send, Shift+Enter for newline)" rows="1"></textarea>
    <button id="send-btn">Send ↑</button>
  </div>
</div>

<div id="toast"></div>

<script>
  // ── Session identity (tab-scoped, survives refresh) ───────────────────────
  let sessionId = sessionStorage.getItem('cf_ai_session');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('cf_ai_session', sessionId);
  }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const messagesEl = document.getElementById('messages');
  const emptyEl    = document.getElementById('empty');
  const inputEl    = document.getElementById('input');
  const sendBtn    = document.getElementById('send-btn');
  const clearBtn   = document.getElementById('clear-btn');
  const toastEl    = document.getElementById('toast');

  let isStreaming = false;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function showEmpty(show) {
    emptyEl.style.display = show ? 'flex' : 'none';
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showToast(msg, durationMs = 4000) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), durationMs);
  }

  function addMessage(role, text) {
    showEmpty(false);
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    wrap.innerHTML =
      '<div class="avatar">' + (role === 'user' ? '🧑' : '🤖') + '</div>' +
      '<div class="bubble">' + escapeHTML(text) + '</div>';
    messagesEl.appendChild(wrap);
    scrollBottom();
    return wrap.querySelector('.bubble');
  }

  function addTypingIndicator() {
    showEmpty(false);
    const wrap = document.createElement('div');
    wrap.className = 'msg ai';
    wrap.id = 'typing-indicator';
    wrap.innerHTML =
      '<div class="avatar">🤖</div>' +
      '<div class="bubble typing"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(wrap);
    scrollBottom();
    return wrap;
  }

  function removeTypingIndicator() {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setDisabled(disabled) {
    isStreaming = disabled;
    sendBtn.disabled = disabled;
    inputEl.disabled = disabled;
    sendBtn.textContent = disabled ? '…' : 'Send ↑';
  }

  // ── Load conversation history on page load ────────────────────────────────
  async function loadHistory() {
    try {
      const res = await fetch('/api/history?session=' + sessionId, {
        headers: { 'X-Session-Id': sessionId }
      });
      if (!res.ok) return;
      const { messages } = await res.json();
      if (messages && messages.length > 0) {
        showEmpty(false);
        for (const m of messages) {
          addMessage(m.role === 'user' ? 'user' : 'ai', m.content);
        }
        scrollBottom();
      }
    } catch {
      // History load failure is non-fatal
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;

    inputEl.value = '';
    inputEl.style.height = '';
    setDisabled(true);

    addMessage('user', text);
    const typingEl = addTypingIndicator();

    try {
      const res = await fetch('/api/chat?session=' + sessionId, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId
        },
        body: JSON.stringify({ message: text })
      });

      removeTypingIndicator();

      if (!res.ok || !res.body) {
        let errMsg = 'Request failed (' + res.status + ')';
        try { const j = await res.json(); errMsg = j.error || errMsg; } catch {}
        showToast('⚠️ ' + errMsg);
        setDisabled(false);
        return;
      }

      // Stream SSE response
      const aiBubble = addMessage('ai', '');
      let fullText = '';

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\\n')) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.response) {
                fullText += data.response;
                aiBubble.textContent = fullText;
                scrollBottom();
              }
            } catch { /* skip */ }
          }
        }
      }

      if (!fullText) {
        aiBubble.closest('.msg').remove();
        showToast('⚠️ Empty response from AI. Please try again.');
      }
    } catch (err) {
      removeTypingIndicator();
      console.error(err);
      showToast('⚠️ Network error. Please check your connection.');
    } finally {
      setDisabled(false);
      inputEl.focus();
    }
  }

  // ── Clear conversation ────────────────────────────────────────────────────
  async function clearConversation() {
    if (isStreaming) return;
    try {
      await fetch('/api/history?session=' + sessionId, {
        method: 'DELETE',
        headers: { 'X-Session-Id': sessionId }
      });
    } catch {}
    messagesEl.innerHTML = '';
    messagesEl.appendChild(emptyEl);
    showEmpty(true);
  }

  // ── Event listeners ───────────────────────────────────────────────────────
  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener('input', () => {
    inputEl.style.height = '';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  });

  clearBtn.addEventListener('click', clearConversation);

  // ── Init ──────────────────────────────────────────────────────────────────
  loadHistory();
  inputEl.focus();
</script>
</body>
</html>`;
}
