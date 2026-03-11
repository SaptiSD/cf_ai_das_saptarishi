/** A single chat message in the conversation. */
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Environment bindings declared in wrangler.toml. */
export interface Env {
  /** Workers AI binding – used to run Llama 3.3 inference. */
  AI: Ai;
  /** Durable Object namespace – one instance per chat session. */
  CHAT_SESSION: DurableObjectNamespace;
}

/** Request body for POST /api/chat. */
export interface ChatRequestBody {
  message: string;
}

/** Workflow step identifiers tracked in Durable Object state. */
export type WorkflowStep =
  | "idle"
  | "validating"
  | "loading_context"
  | "invoking_ai"
  | "streaming"
  | "persisting"
  | "error";
