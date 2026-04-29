export type SseConnectionState = "disconnected" | "connecting" | "connected" | "auth_error" | "stale";

export type SseConnectionStatus = {
  state: SseConnectionState;
  message: string;
  url: string;
  attempt: number;
  lastEventId?: string;
};

export type RawSseEvent = {
  id?: string;
  event?: string;
  data: unknown;
};

type SseConnectorOptions = {
  url: string;
  token?: string;
  staleAfterMs?: number;
  onStatus: (status: SseConnectionStatus) => void;
  onEvent: (event: RawSseEvent) => void;
};

type ParsedSseBlock = {
  id?: string;
  event?: string;
  data?: string;
};

const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 12_000;

export class SseConnector {
  private readonly staleAfterMs: number;
  private stopped = true;
  private controller: AbortController | null = null;
  private lastEventId = "";
  private lastActivityAt = 0;
  private status: SseConnectionState = "disconnected";
  private staleTimer = 0;

  constructor(private readonly options: SseConnectorOptions) {
    this.staleAfterMs = options.staleAfterMs ?? 8_000;
  }

  start(): void {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    this.lastActivityAt = Date.now();
    this.staleTimer = window.setInterval(() => this.checkStale(), 1_000);
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    this.controller = null;
    window.clearInterval(this.staleTimer);
    this.emitStatus("disconnected", "SSE disconnected");
  }

  private async run(): Promise<void> {
    let attempt = 0;
    let reconnectDelay = MIN_RECONNECT_MS;

    while (!this.stopped) {
      attempt += 1;
      this.controller = new AbortController();
      this.emitStatus("connecting", `Connecting to SSE stream (attempt ${attempt})`, attempt);

      try {
        await this.openStream(this.controller.signal, attempt);
        reconnectDelay = MIN_RECONNECT_MS;
      } catch (error) {
        if (this.stopped) {
          break;
        }

        if (error instanceof AuthError) {
          this.emitStatus("auth_error", error.message, attempt);
          break;
        }

        this.emitStatus("disconnected", formatError(error), attempt);
        await sleep(reconnectDelay);
        reconnectDelay = Math.min(MAX_RECONNECT_MS, reconnectDelay * 1.8);
      } finally {
        this.controller = null;
      }
    }
  }

  private async openStream(signal: AbortSignal, attempt: number): Promise<void> {
    const response = await fetch(this.buildUrl(), {
      cache: "no-store",
      headers: this.buildHeaders(),
      signal
    });

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(`SSE auth failed: HTTP ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`SSE connection failed: HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("SSE response did not include a readable body");
    }

    this.markActivity();
    this.emitStatus("connected", "SSE connected", attempt);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!this.stopped) {
      const { done, value } = await reader.read();
      if (done) {
        throw new Error("SSE stream closed");
      }

      this.markActivity();
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        this.handleBlock(block);
        boundary = buffer.indexOf("\n\n");
      }
    }
  }

  private handleBlock(block: string): void {
    const parsed = parseSseBlock(block);
    if (!parsed.data) {
      return;
    }

    if (parsed.id) {
      this.lastEventId = parsed.id;
    }

    try {
      const data = JSON.parse(parsed.data);
      this.options.onEvent({
        id: parsed.id,
        event: parsed.event,
        data
      });
    } catch (error) {
      this.emitStatus("connected", `Ignored invalid SSE JSON: ${formatError(error)}`);
    }
  }

  private buildUrl(): string {
    if (!this.lastEventId) {
      return this.options.url;
    }

    const url = new URL(this.options.url, window.location.href);
    if (!url.searchParams.has("after")) {
      url.searchParams.set("after", this.lastEventId);
    }
    return url.toString();
  }

  private buildHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "text/event-stream"
    };
    const token = this.options.token?.trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private markActivity(): void {
    this.lastActivityAt = Date.now();
    if (this.status === "stale") {
      this.emitStatus("connected", "SSE connected");
    }
  }

  private checkStale(): void {
    if (this.status !== "connected") {
      return;
    }

    if (Date.now() - this.lastActivityAt > this.staleAfterMs) {
      this.emitStatus("stale", "SSE stream is stale");
    }
  }

  private emitStatus(state: SseConnectionState, message: string, attempt = 0): void {
    this.status = state;
    this.options.onStatus({
      state,
      message,
      url: this.options.url,
      attempt,
      lastEventId: this.lastEventId || undefined
    });
  }
}

function parseSseBlock(block: string): ParsedSseBlock {
  const parsed: ParsedSseBlock = {};
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const rawValue = separator >= 0 ? line.slice(separator + 1) : "";
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "id") {
      parsed.id = value;
    } else if (field === "event") {
      parsed.event = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (dataLines.length > 0) {
    parsed.data = dataLines.join("\n");
  }

  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "SSE connection aborted";
  }
  return error instanceof Error ? error.message : String(error);
}

class AuthError extends Error {}
