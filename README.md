# CF AI Assistant – Saptarishi

An AI-powered chat application built on the Cloudflare developer platform.

## Architecture

| Requirement | Implementation |
|---|---|
| **LLM** | Meta **Llama 3.3 70B** via **Cloudflare Workers AI** (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) |
| **Workflow / coordination** | **Durable Object** (`ChatSession`) – explicit multi-step pipeline (validate → load context → invoke AI → stream → persist) with alarm-based TTL cleanup |
| **User input (chat)** | Browser-based chat UI served directly from the Worker, with **Server-Sent Events** for real-time streaming responses |
| **Memory / state** | Conversation history persisted in **Durable Object Storage** per session, with a 7-day TTL |

```
Browser ──(HTTP/SSE)──► Worker (src/index.ts)
                              │
                     session routing (X-Session-Id)
                              │
                    ChatSession Durable Object
                       (src/chatSession.ts)
                              │
                    ┌─────────┴──────────┐
              DO Storage           Workers AI
          (conversation memory)   (Llama 3.3 70B)
```

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers enabled

### Install dependencies

```bash
npm install
```

### Run locally

```bash
npm run dev
```

Open <http://localhost:8787> in your browser.

### Deploy to Cloudflare

```bash
npm run deploy
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Chat UI |
| `POST` | `/api/chat` | Send a message; body `{ "message": "..." }`. Returns SSE stream. |
| `GET` | `/api/history` | Retrieve conversation history for the current session. |
| `DELETE` | `/api/history` | Clear conversation history for the current session. |

Pass `X-Session-Id` header (or `?session=` query parameter) to target a specific session.
