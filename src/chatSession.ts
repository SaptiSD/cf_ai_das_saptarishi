import { DurableObject } from "cloudflare:workers";
import type { Env, Message, WorkflowStep } from "./types";

/**
 * Llama 3.3 model available on Cloudflare Workers AI.
 * See: https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/
 */
const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM_PROMPT =
  "You are a helpful AI assistant powered by Meta's Llama 3.3 model, " +
  "running on Cloudflare Workers AI. Be concise, friendly, and accurate.";

/** Maximum number of conversation turns to keep in memory (oldest are dropped). */
const MAX_HISTORY = 40;

/** Sessions are automatically cleaned up 7 days after the last message. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ChatSession – Durable Object that provides:
 *   - **Memory / state**: conversation history persisted in DO storage.
 *   - **Workflow / coordination**: multi-step processing pipeline with an
 *     explicit `workflowStep` field and alarm-based session cleanup.
 *   - **LLM integration**: streams responses from Llama 3.3 via Workers AI.
 */
export class ChatSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  // ─── Fetch handler ────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS pre-flight
    if (request.method === "OPTIONS") {
      return this.cors(new Response(null, { status: 204 }));
    }

    if (request.method === "POST" && url.pathname.endsWith("/chat")) {
      return this.handleChat(request);
    }
    if (request.method === "GET" && url.pathname.endsWith("/history")) {
      return this.handleGetHistory();
    }
    if (request.method === "DELETE" && url.pathname.endsWith("/history")) {
      return this.handleClearHistory();
    }

    return new Response("Not Found", { status: 404 });
  }

  // ─── Workflow step helpers ─────────────────────────────────────────────────

  private async setStep(step: WorkflowStep): Promise<void> {
    await this.ctx.storage.put("workflowStep", step);
  }

  // ─── Storage helpers ───────────────────────────────────────────────────────

  private async loadMessages(): Promise<Message[]> {
    return (await this.ctx.storage.get<Message[]>("messages")) ?? [];
  }

  private async persistMessages(messages: Message[]): Promise<void> {
    await this.ctx.storage.put("messages", messages);
    // Reset 7-day TTL alarm on every write
    await this.ctx.storage.setAlarm(Date.now() + SESSION_TTL_MS);
  }

  // ─── Route handlers ────────────────────────────────────────────────────────

  /**
   * POST /api/chat
   *
   * Workflow pipeline:
   *  1. validating      – parse and validate input
   *  2. loading_context – load conversation history from storage
   *  3. invoking_ai     – start Workers AI streaming request
   *  4. streaming       – pipe AI stream to client while capturing text
   *  5. persisting      – save updated history to storage
   */
  private async handleChat(request: Request): Promise<Response> {
    // Step 1 – validate input
    await this.setStep("validating");
    let body: { message?: unknown };
    try {
      body = await request.json<{ message?: unknown }>();
    } catch {
      await this.setStep("error");
      return this.jsonError("Invalid JSON body", 400);
    }

    const userMessage =
      typeof body.message === "string" ? body.message.trim() : "";
    if (!userMessage) {
      await this.setStep("error");
      return this.jsonError("Message is required and must be a non-empty string", 400);
    }

    // Step 2 – load conversation context
    await this.setStep("loading_context");
    const messages = await this.loadMessages();
    messages.push({ role: "user", content: userMessage });
    const context = messages.slice(-MAX_HISTORY);

    // Step 3 – invoke Llama 3.3 with streaming
    await this.setStep("invoking_ai");
    let aiStream: ReadableStream<Uint8Array>;
    try {
      const result = await this.env.AI.run(AI_MODEL, {
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...context],
        stream: true,
        max_tokens: 1024,
      });
      aiStream = result as ReadableStream<Uint8Array>;
    } catch (err) {
      await this.setStep("error");
      console.error("Workers AI error:", err);
      return this.jsonError("AI inference failed. Please try again.", 502);
    }

    // Step 4 – stream response to client while capturing full text
    await this.setStep("streaming");
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const decoder = new TextDecoder();
    let assistantText = "";

    // Background task: tee the AI stream → client + capture for persistence
    (async () => {
      const reader = aiStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Parse SSE lines to accumulate the assistant's response text
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split("\n")) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try {
                const data = JSON.parse(line.slice(6)) as { response?: string };
                if (data.response) assistantText += data.response;
              } catch {
                // unparseable line – skip
              }
            }
          }

          await writer.write(value);
        }
      } catch (err) {
        console.error("Stream processing error:", err);
      } finally {
        reader.releaseLock();
        try {
          await writer.close();
        } catch {
          // already closed
        }

        // Step 5 – persist updated conversation history
        if (assistantText) {
          await this.setStep("persisting");
          context.push({ role: "assistant", content: assistantText });
          await this.persistMessages(context.slice(-MAX_HISTORY));
        }
        await this.setStep("idle");
      }
    })();

    return this.cors(
      new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      })
    );
  }

  /** GET /api/history – return full conversation history for this session. */
  private async handleGetHistory(): Promise<Response> {
    const messages = await this.loadMessages();
    return this.cors(
      new Response(JSON.stringify({ messages }), {
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  /** DELETE /api/history – clear conversation history for this session. */
  private async handleClearHistory(): Promise<Response> {
    await this.ctx.storage.delete("messages");
    await this.ctx.storage.deleteAlarm();
    await this.setStep("idle");
    return this.cors(
      new Response(
        JSON.stringify({ success: true, message: "Conversation cleared" }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
  }

  // ─── Alarm handler (workflow: session TTL cleanup) ─────────────────────────

  /** Called by the Workers runtime when the 7-day session TTL alarm fires. */
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  // ─── Utility helpers ───────────────────────────────────────────────────────

  private cors(response: Response): Response {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, X-Session-Id");
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }

  private jsonError(message: string, status: number): Response {
    return this.cors(
      new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
}
