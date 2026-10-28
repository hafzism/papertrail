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
  draftId: string | null;
  reviewRequired: boolean;
  takeoverFingerprint: string | null;
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
  readonly portalFields?: Readonly<Record<string,string>>;
  readonly attachments?: ReadonlyArray<{ filename: string; mimeType: string; sha256: string; bytesBase64: string }>;
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
  readonly reference: string | null;
  readonly payloadMatchesApproval: boolean | null;
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
  private creating = false;

  constructor(private readonly config: GatewayConfig) {}

  private async acquireBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.launch({
      headless: this.config.headless,
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
    if (this.creating || this.session && this.session.state !== "closed" && this.session.state !== "expired") {
      throw new Error("BROWSER_SLOT_BUSY");
    }
    this.creating = true;
    try {
    const browser = await this.acquireBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const now = Date.now();
    const expiresAt = now + this.config.maxSessionMinutes * 60_000;
    const session: BrowserSession = {
      id: randomUUID(), ownerId: input.ownerId, applicationId: input.applicationId, runId: input.runId,
      destination: input.destination, state: "starting", createdAt: asIso(now), expiresAt: asIso(expiresAt), lastActivityAt: asIso(now),
      context, page, ticketHash: null, ticketExpiresAt: null, approvedDemoAction: input.approvedDemoAction ?? null, actionExecuted: false, idleTimeout: null, draftId: null, reviewRequired: false, takeoverFingerprint: null,
      timeout: setTimeout(() => { void this.close(session.id, "expired"); }, this.config.maxSessionMinutes * 60_000),
    };
    this.session = session;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) session.lastActivityAt = new Date().toISOString();
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (/^https?:/.test(request.url())) {
        const destinationOrigin = new URL(request.url()).origin;
        if (!this.config.allowedDestinationOrigins.has(destinationOrigin)) return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    page.on("popup", popup => { void popup.close(); });
    try {
      await page.goto(input.destination, { waitUntil: "domcontentloaded", timeout: 20_000 });
      session.state = "agent_control";
      this.scheduleIdleClose(session);
      return this.view(session);
    } catch (error) {
      await this.close(session.id, "closed");
      throw error;
    }
    } finally { this.creating = false; }
  }

  get(sessionId: string): BrowserSession | null {
    return this.session?.id === sessionId && this.session.state !== "closed" && this.session.state !== "expired" ? this.session : null;
  }

  view(session: BrowserSession): BrowserSessionView {
    const { id, ownerId, applicationId, runId, destination, state, createdAt, expiresAt, lastActivityAt } = session;
    return { id, ownerId, applicationId, runId, destination, state, createdAt, expiresAt, lastActivityAt };
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
    const receipt = session.page.locator("[data-reference]").first();
    const reference = await receipt.count() ? await receipt.getAttribute("data-reference") : null;
    let payloadMatchesApproval: boolean | null = null;
    if(reference && session.approvedDemoAction){
      try{
        const details=JSON.parse(await session.page.locator("#receipt-payload").textContent({timeout:2000})||"null") as {fields:Record<string,string>;files:Array<{sha256:string}>};
        const approved=session.approvedDemoAction;
        const hashes=(approved.attachments??[]).map(file=>file.sha256).sort();
        payloadMatchesApproval=Object.entries(approved.portalFields??{}).every(([key,value])=>details.fields[key]===value)&&JSON.stringify(details.files.map(file=>file.sha256).sort())===JSON.stringify(hashes);
      }catch{payloadMatchesApproval=false;}
    }
    return { url: session.page.url(), title: await session.page.title(), controls, reference, payloadMatchesApproval };
  }

  issueTakeoverTicket(sessionId: string): TakeoverTicket {
    const session = this.get(sessionId);
    if (!session) throw new Error("BROWSER_SESSION_NOT_FOUND");
    if (this.config.headless) throw new Error("INTERACTIVE_DISPLAY_REQUIRED");
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
    if (session.state !== "agent_control" || session.reviewRequired) throw new Error("BROWSER_REVIEW_OR_RESUME_REQUIRED");
    const currentUrl = new URL(session.page.url());
    const expectedUrl = new URL(session.destination);
    if (currentUrl.origin !== expectedUrl.origin || currentUrl.pathname !== expectedUrl.pathname || !/^\/apply\/(grant|exam|renewal)$/.test(currentUrl.pathname)) throw new Error("PORTAL_STATE_CHANGED_REVIEW_REQUIRED");
    const attachments = action.attachments ?? [];
    if (!attachments.length) throw new Error("APPROVED_ATTACHMENTS_REQUIRED");
    session.actionExecuted = true;
    const assertControl=()=>{if(session.state!=="agent_control"||session.reviewRequired)throw new Error("BROWSER_PAUSED_FOR_HUMAN_CONTROL");};
    assertControl();
    const renewal=action.portalFields?.kind==="renewal";
    await session.page.locator(renewal?"#renewal-person":"#reference-name").fill(action.applicantName);
    assertControl();
    await session.page.locator(renewal?"#renewal-type":"#reference-type").selectOption(action.applicantType);
    for (const [key,id] of [["session","portal-session"],["centre","portal-centre"],["course","portal-course"],["location","portal-location"]] as const) {
      assertControl();
      if (action.portalFields?.[key]) await session.page.locator(`#${renewal&&key==="location"?"renewal-location":id}`).selectOption(action.portalFields[key]);
    }
    assertControl();
    await session.page.getByRole("button", { name: renewal?"Continue to attachments":"Continue to evidence", exact: true }).click();
    await session.page.waitForURL(/\/drafts\/[0-9a-f-]+\/evidence$/, { timeout: 10_000 });
    session.draftId = /\/drafts\/([0-9a-f-]+)\//.exec(session.page.url())?.[1] ?? null;
    assertControl();
    await session.page.locator("#portal-evidence").setInputFiles(attachments.map(file => ({ name:file.filename,mimeType:file.mimeType,buffer:Buffer.from(file.bytesBase64,"base64") })));
    await session.page.getByRole("button", { name: "Review application", exact: true }).click();
    await session.page.waitForURL(/\/review$/, { timeout: 10_000 });
    assertControl();
    const review = session.page.locator("article pre");
    const observedFields = JSON.parse(await review.nth(0).innerText()) as Record<string,string>;
    for(const [key,value]of Object.entries(action.portalFields ?? {}))if(observedFields[key]!==value)throw new Error("PORTAL_REVIEW_FIELDS_CHANGED");
    const observedFiles = JSON.parse(await review.nth(1).innerText()) as Array<{sha256:string}>;
    if(observedFiles.length!==attachments.length || observedFiles.some(file=>!attachments.some(approved=>approved.sha256===file.sha256)))throw new Error("PORTAL_REVIEW_ATTACHMENTS_CHANGED");
    const declaration = await session.page.locator("label").filter({has:session.page.locator("#reference-declaration")}).innerText();
    if(declaration.trim()!=="I understand this is a fictional reference portal and am using test data only.")throw new Error("PORTAL_DECLARATION_CHANGED");
    await session.page.locator("#reference-declaration").check();
    assertControl();
    await session.page.locator("#portal-submit").click();
    const acknowledgement = session.page.getByRole("status");
    await acknowledgement.waitFor({ state: "visible", timeout: 10_000 });
    const acknowledgementText = (await acknowledgement.textContent())?.trim() || "";
    const reference = /Reference:\s*(DEMO-[A-Z0-9-]+)/.exec(acknowledgementText)?.[1];
    if (!reference) throw new Error("DEMO_ACKNOWLEDGEMENT_NOT_OBSERVED");
    session.lastActivityAt = new Date().toISOString();
    const observation=await this.observe(sessionId);
    if(observation.payloadMatchesApproval!==true)throw new Error("RECEIPT_PAYLOAD_DIFFERS_FROM_APPROVAL");
    return { reference, observation };
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
    // Disconnect never authorizes the agent to resume dispatch.
    this.scheduleIdleClose(session);
  }

  async resume(sessionId: string): Promise<{ observation: SanitizedObservation; reviewRequired: boolean }> {
    const session = this.get(sessionId);
    if (!session || session.state !== "human_control") throw new Error("BROWSER_NOT_IN_HUMAN_CONTROL");
    session.state = "agent_control";
    const fingerprint = await this.fingerprint(session);
    session.reviewRequired = session.takeoverFingerprint !== fingerprint;
    this.scheduleIdleClose(session);
    return { observation: await this.observe(sessionId), reviewRequired: session.reviewRequired };
  }

  private async fingerprint(session: BrowserSession): Promise<string> {
    const fields = await session.page.locator("input:not([type=password]):not([type=hidden]),select,textarea").evaluateAll(elements => elements.map(element => {
      const input = element as HTMLInputElement;
      return { name:input.name,type:input.type,value:input.value,checked:input.checked };
    }));
    return createHash("sha256").update(JSON.stringify({ url:session.page.url(),fields })).digest("hex");
  }

  async prepareTakeover(sessionId: string): Promise<TakeoverTicket> {
    const session = this.get(sessionId);
    if (!session) throw new Error("BROWSER_SESSION_NOT_FOUND");
    session.takeoverFingerprint = await this.fingerprint(session);
    const ticket = this.issueTakeoverTicket(sessionId);
    session.state = "human_control";
    return ticket;
  }

  async reconcile(sessionId: string): Promise<SanitizedObservation> {
    const session = this.get(sessionId);
    if (!session) throw new Error("BROWSER_SESSION_NOT_FOUND");
    if (session.state === "human_control") throw new Error("BROWSER_RESUME_REQUIRED");
    if (session.draftId) await session.page.goto(new URL(`/status?draft=${session.draftId}`,session.destination).toString(), { waitUntil:"domcontentloaded",timeout:15_000 });
    return this.observe(sessionId);
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
