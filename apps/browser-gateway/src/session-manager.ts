import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { GatewayConfig } from "./config.js";

export type SessionState = "starting" | "agent_control" | "human_control" | "expired" | "closed";

export interface BrowserSessionView {
  readonly id: string;
  readonly ownerId: string;
  readonly applicationId: string;
  readonly runId: string;
  readonly destination: string;
  readonly state: SessionState;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastActivityAt: string;
}

interface BrowserSession extends Omit<BrowserSessionView, "state" | "lastActivityAt"> {
  state: SessionState;
  lastActivityAt: string;
  readonly context: BrowserContext;
  readonly page: Page;
  ticketHash: string | null;
  ticketExpiresAt: number | null;
  readonly approvedDemoAction: ApprovedDemoAction | null;
  actionExecuted: boolean;
  timeout: NodeJS.Timeout;
  idleTimeout: NodeJS.Timeout | null;
}

export interface CreateSessionInput {
  readonly ownerId: string;
  readonly applicationId: string;
  readonly runId: string;
  readonly destination: string;
  readonly approvedDemoAction?: ApprovedDemoAction;
}

/** The only executable adapter in this local runtime. Dispatch never receives its values. */
export interface ApprovedDemoAction {
  readonly actionId: string;
  readonly kind: "reference_portal_acknowledgement";
  readonly applicantName: string;
  readonly applicantType: "student" | "community-member";
  readonly declarationAccepted: true;
  readonly payloadSha256: string;
}

export interface TakeoverTicket {
  readonly ticket: string;
  readonly expiresAt: string;
  readonly takeoverUrl: string;
}

export interface SanitizedObservation {
  readonly url: string;
  readonly title: string;
  readonly controls: ReadonlyArray<{ label: string; type: string; required: boolean }>;
}

function ticketHash(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

function asIso(time: number): string {
  return new Date(time).toISOString();
}

/**
 * A deliberately one-slot browser manager. Every session gets a fresh incognito
 * context and closes it before the next owner can acquire the physical display.
 * It does not implement arbitrary selector/script execution.
 */
export class BrowserSessionManager {
  private browser: Browser | null = null;
  private session: BrowserSession | null = null;

  constructor(private readonly config: GatewayConfig) {}

  private async acquireBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.launch({
      headless: false,
      env: { ...process.env, DISPLAY: this.config.display },
      args: ["--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"],
    });
    return this.browser;
  }

  private clearIdleTimer(session: BrowserSession): void {
    if (session.idleTimeout) clearTimeout(session.idleTimeout);
    session.idleTimeout = null;
  }

  private scheduleIdleClose(session: BrowserSession): void {
    this.clearIdleTimer(session);
    session.idleTimeout = setTimeout(() => { void this.close(session.id, "idle"); }, this.config.idleMinutes * 60_000);
  }

  async create(input: CreateSessionInput): Promise<BrowserSessionView> {
    if (this.session && this.session.state !== "closed" && this.session.state !== "expired") {
      throw new Error("BROWSER_SLOT_BUSY");
    }
    const browser = await this.acquireBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const now = Date.now();
    const expiresAt = now + this.config.maxSessionMinutes * 60_000;
    const session: BrowserSession = {
      id: randomUUID(), ownerId: input.ownerId, applicationId: input.applicationId, runId: input.runId,
      destination: input.destination, state: "starting", createdAt: asIso(now), expiresAt: asIso(expiresAt), lastActivityAt: asIso(now),
      context, page, ticketHash: null, ticketExpiresAt: null, approvedDemoAction: input.approvedDemoAction ?? null, actionExecuted: false, idleTimeout: null,
      timeout: setTimeout(() => { void this.close(session.id, "expired"); }, this.config.maxSessionMinutes * 60_000),
    };
    this.session = session;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) session.lastActivityAt = new Date().toISOString();
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        const destinationOrigin = new URL(request.url()).origin;
        if (!this.config.allowedDestinationOrigins.has(destinationOrigin)) return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    try {
      await page.goto(input.destination, { waitUntil: "domcontentloaded", timeout: 20_000 });
      session.state = "agent_control";
      return this.view(session);
    } catch (error) {
      await this.close(session.id, "closed");
      throw error;
    }
  }

  get(sessionId: string): BrowserSession | null {
    return this.session?.id === sessionId && this.session.state !== "closed" && this.session.state !== "expired" ? this.session : null;
  }

  view(session: BrowserSession): BrowserSessionView {
    const { context: _context, page: _page, timeout: _timeout, idleTimeout: _idleTimeout, ticketHash: _ticketHash, ticketExpiresAt: _ticketExpiresAt, approvedDemoAction: _approvedDemoAction, actionExecuted: _actionExecuted, ...view } = session;
    return view;
  }

  async observe(sessionId: string): Promise<SanitizedObservation> {
    const session = this.get(sessionId);
    if (!session) throw new Error("BROWSER_SESSION_NOT_FOUND");
    const controls = await session.page.locator("input, select, textarea, button").evaluateAll((elements) => elements.slice(0, 100).map((element) => {
      const input = element as HTMLInputElement;
      const label = input.labels?.[0]?.textContent?.trim() || input.getAttribute("aria-label") || input.getAttribute("name") || input.id || element.tagName.toLowerCase();
      return { label: label.slice(0, 200), type: input.type || element.tagName.toLowerCase(), required: input.required || input.getAttribute("aria-required") === "true" };
    }));
    session.lastActivityAt = new Date().toISOString();
    return { url: session.page.url(), title: await session.page.title(), controls };
  }

  issueTakeoverTicket(sessionId: string): TakeoverTicket {
    const session = this.get(sessionId);
    if (!session) throw new Error("BROWSER_SESSION_NOT_FOUND");
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 30_000;
    session.ticketHash = ticketHash(ticket);
    session.ticketExpiresAt = expiresAt;
    return { ticket, expiresAt: asIso(expiresAt), takeoverUrl: `${this.config.publicOrigin}/takeover/${session.id}?ticket=${encodeURIComponent(ticket)}` };
  }

  /**
   * Bounded, source-controlled adapter for the repository's fictional portal.
   * It accepts no caller-provided selectors, scripts, URLs, or field values.
   */
  async executeApprovedDemoAction(sessionId: string, actionId: string): Promise<{ reference: string; observation: SanitizedObservation }> {
    const session = this.get(sessionId);
    if (!session) throw new Error("BROWSER_SESSION_NOT_FOUND");
    const action = session.approvedDemoAction;
    if (!action || action.actionId !== actionId) throw new Error("UNSUPPORTED_APPROVED_ACTION");
    if (session.actionExecuted) throw new Error("ACTION_ALREADY_EXECUTED");
    const currentUrl = new URL(session.page.url());
    const expectedUrl = new URL(session.destination);
    if (currentUrl.origin !== expectedUrl.origin || currentUrl.pathname !== "/reference-portal") throw new Error("PORTAL_STATE_CHANGED_REVIEW_REQUIRED");
    await session.page.locator("#reference-name").fill(action.applicantName);
    await session.page.locator("#reference-type").selectOption(action.applicantType);
    await session.page.locator("#reference-declaration").check();
    await session.page.locator("button[type=submit]").click();
    const acknowledgement = session.page.getByRole("status");
    await acknowledgement.waitFor({ state: "visible", timeout: 10_000 });
    const acknowledgementText = (await acknowledgement.textContent())?.trim() || "";
    const reference = /Reference:\s*(DEMO-[A-Z0-9-]+)/.exec(acknowledgementText)?.[1];
    if (!reference) throw new Error("DEMO_ACKNOWLEDGEMENT_NOT_OBSERVED");
    session.actionExecuted = true;
    session.lastActivityAt = new Date().toISOString();
    return { reference, observation: await this.observe(sessionId) };
  }

  validateTakeoverTicket(sessionId: string, ticket: string | null, consume: boolean): BrowserSession | null {
    const session = this.get(sessionId);
    if (!session || !ticket || !session.ticketHash || !session.ticketExpiresAt || session.ticketExpiresAt <= Date.now()) return null;
    if (ticketHash(ticket) !== session.ticketHash) return null;
    if (consume) {
      session.ticketHash = null;
      session.ticketExpiresAt = null;
      session.state = "human_control";
      this.clearIdleTimer(session);
    }
    return session;
  }

  endTakeover(sessionId: string): void {
    const session = this.get(sessionId);
    if (!session || session.state !== "human_control") return;
    session.state = "agent_control";
    this.scheduleIdleClose(session);
  }

  async close(sessionId: string, reason: "closed" | "expired" | "idle" = "closed"): Promise<void> {
    const session = this.session;
    if (!session || session.id !== sessionId) return;
    this.clearIdleTimer(session);
    clearTimeout(session.timeout);
    session.ticketHash = null;
    session.ticketExpiresAt = null;
    session.state = reason === "expired" ? "expired" : "closed";
    try { await session.context.close(); } finally { this.session = null; }
  }

  async shutdown(): Promise<void> {
    if (this.session) await this.close(this.session.id);
    await this.browser?.close();
    this.browser = null;
  }
}
