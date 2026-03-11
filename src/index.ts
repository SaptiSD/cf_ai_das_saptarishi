import { ChatSession } from "./chatSession";
import type { Env } from "./types";
import { getUIHTML } from "./ui";

// Re-export the Durable Object class so Wrangler can discover it.
export { ChatSession };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── Serve the chat UI ──────────────────────────────────────────────────
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(getUIHTML(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // ── API routes (proxied to ChatSession Durable Object) ─────────────────
    if (url.pathname.startsWith("/api/")) {
      // Derive a session ID from the request so each user gets their own DO
      // instance (and therefore isolated conversation memory).
      const sessionId =
        request.headers.get("X-Session-Id") ||
        url.searchParams.get("session") ||
        "default";

      const doId = env.CHAT_SESSION.idFromName(sessionId);
      const session = env.CHAT_SESSION.get(doId);

      // Forward the request to the Durable Object as-is.
      return session.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
