import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Socket } from "node:net";
import { connect } from "node:net";
import { join, normalize } from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { hasGatewaySecret, isAllowedDestination, loadGatewayConfig } from "./config.js";
import { BrowserSessionManager, type ApprovedDemoAction } from "./session-manager.js";

interface CreateSessionBody { ownerId?: unknown; applicationId?: unknown; runId?: unknown; destination?: unknown; approvedDemoAction?: unknown }
interface ExecuteActionBody { actionId?: unknown }

const config = loadGatewayConfig();
const sessions = new BrowserSessionManager(config);
const noVncRoot = process.env.NOVNC_ROOT?.trim() || "/usr/share/novnc";

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function requestOrigin(request: IncomingMessage): string | null {
  const raw = request.headers.origin;
  if (!raw) return null;
  try { return new URL(raw).origin; } catch { return null; }
}

function isInternalRequest(request: IncomingMessage): boolean {
  const header = request.headers["x-papertrail-gateway-secret"];
  return hasGatewaySecret(typeof header === "string" ? header : undefined, config.gatewaySecret);
}

async function readJson(request: IncomingMessage): Promise<CreateSessionBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).byteLength > 16_384) throw new Error("REQUEST_TOO_LARGE");
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as CreateSessionBody; } catch { throw new Error("INVALID_JSON"); }
}

function stringField(body: CreateSessionBody, key: keyof CreateSessionBody): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 && value.length <= 2048 ? value.trim() : null;
}

function approvedDemoAction(value: unknown): ApprovedDemoAction | null {
  if (!value || typeof value !== "object") return null;
  const action = value as Record<string, unknown>;
  const actionId = typeof action.actionId === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(action.actionId) ? action.actionId : null;
  const applicantName = typeof action.applicantName === "string" && action.applicantName.trim().length > 0 && action.applicantName.length <= 200 ? action.applicantName.trim() : null;
  const applicantType = action.applicantType === "student" || action.applicantType === "community-member" ? action.applicantType : null;
  const payloadSha256 = typeof action.payloadSha256 === "string" && /^[a-f0-9]{64}$/i.test(action.payloadSha256) ? action.payloadSha256 : null;
  if (!actionId || !applicantName || !applicantType || !payloadSha256 || action.kind !== "reference_portal_acknowledgement" || action.declarationAccepted !== true) return null;
  return { actionId, applicantName, applicantType, payloadSha256, kind: "reference_portal_acknowledgement", declarationAccepted: true };
}

function parsePath(request: IncomingMessage): string {
  return new URL(request.url || "/", config.publicOrigin).pathname;
}

function sessionIdFor(path: string, suffix: string): string | null {
  const match = new RegExp(`^/v1/sessions/([0-9a-f-]{36})${suffix}$`, "i").exec(path);
  return match?.[1] ?? null;
}

function sendNoVncShell(response: ServerResponse, sessionId: string, ticket: string): void {
  const encodedTicket = JSON.stringify(ticket).replace(/</g, "\\u003c");
  const encodedSessionId = JSON.stringify(sessionId);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" });
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PaperTrail private browser takeover</title><style>html,body,#screen{height:100%;margin:0;background:#0b1220;color:#fff;font-family:system-ui}#notice{position:fixed;top:12px;left:12px;z-index:2;background:#102a43;padding:8px 12px;border-radius:6px;font-size:14px}</style><div id="notice">Private browser takeover. Do not share this window.</div><div id="screen"></div><script type="module">import RFB from "/novnc/core/rfb.js";const ticket=${encodedTicket};const sessionId=${encodedSessionId};const scheme=location.protocol==="https:"?"wss":"ws";const rfb=new RFB(document.getElementById("screen"),scheme+"://"+location.host+"/v1/sessions/"+sessionId+"/takeover?ticket="+encodeURIComponent(ticket));rfb.scaleViewport=true;rfb.resizeSession=true;rfb.addEventListener("connect",()=>document.getElementById("notice").textContent="You control this private browser session.");rfb.addEventListener("disconnect",()=>document.getElementById("notice").textContent="The browser session was closed or disconnected.");</script></html>`);
}

function serveNoVncAsset(request: IncomingMessage, response: ServerResponse, path: string): void {
  const relative = normalize(path.slice("/novnc/".length)).replace(/^([/\\])+/, "");
  const file = join(noVncRoot, relative);
  if (!file.startsWith(`${noVncRoot}/`) || !existsSync(file)) return json(response, 404, { error: "NOT_FOUND" });
  response.writeHead(200, { "cache-control": "public, max-age=3600" });
  createReadStream(file).pipe(response);
}

const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (client: WebSocket, request: IncomingMessage, sessionId: string) => {
  const target = connect({ host: config.vncHost, port: config.vncPort });
  const finish = () => { if (client.readyState === WebSocket.OPEN) client.close(); target.destroy(); sessions.endTakeover(sessionId); };
  target.on("data", (chunk: Buffer) => { if (client.readyState === WebSocket.OPEN) client.send(chunk, { binary: true }); });
  target.once("error", finish); target.once("close", finish);
  client.on("message", (message, isBinary) => { if (isBinary) target.write(message as Buffer); });
  client.once("close", finish); client.once("error", finish);
});

const server = createServer(async (request, response) => {
  const path = parsePath(request);
  if (request.method === "GET" && path === "/health") return json(response, 200, { service: "browser-gateway", status: "ok", provider: "local", maxConcurrent: 1 });
  if (request.method === "GET" && path.startsWith("/novnc/")) return serveNoVncAsset(request, response, path);
  if (request.method === "GET" && /^\/takeover\/[0-9a-f-]{36}$/i.test(path)) {
    const url = new URL(request.url || "/", config.publicOrigin);
    const session = sessions.validateTakeoverTicket(path.split("/").at(-1) || "", url.searchParams.get("ticket"), false);
    if (!session) return json(response, 403, { error: "TAKEOVER_TICKET_INVALID" });
    return sendNoVncShell(response, session.id, url.searchParams.get("ticket") || "");
  }
  if (!isInternalRequest(request)) return json(response, 401, { error: "GATEWAY_AUTH_REQUIRED" });
  if (request.method === "POST" && path === "/v1/sessions") {
    try {
      const body = await readJson(request);
      const ownerId = stringField(body, "ownerId"); const applicationId = stringField(body, "applicationId"); const runId = stringField(body, "runId"); const destination = stringField(body, "destination");
      if (!ownerId || !applicationId || !runId || !destination || !isAllowedDestination(destination, config.allowedDestinationOrigins)) return json(response, 400, { error: "INVALID_SESSION_SCOPE_OR_DESTINATION" });
      const action = body.approvedDemoAction === undefined ? undefined : approvedDemoAction(body.approvedDemoAction);
      if (body.approvedDemoAction !== undefined && !action) return json(response, 400, { error: "INVALID_APPROVED_DEMO_ACTION" });
      if (action && new URL(destination).pathname !== "/reference-portal") return json(response, 400, { error: "DEMO_ACTION_DESTINATION_INVALID" });
      return json(response, 201, { session: await sessions.create({ ownerId, applicationId, runId, destination, ...(action ? { approvedDemoAction: action } : {}) }) });
    } catch (error) { return json(response, error instanceof Error && error.message === "BROWSER_SLOT_BUSY" ? 409 : 422, { error: error instanceof Error ? error.message : "SESSION_CREATE_FAILED" }); }
  }
  const observationId = sessionIdFor(path, "/observation");
  if (request.method === "GET" && observationId) {
    try { return json(response, 200, { observation: await sessions.observe(observationId) }); } catch (error) { return json(response, 404, { error: error instanceof Error ? error.message : "NOT_FOUND" }); }
  }
  const ticketId = sessionIdFor(path, "/takeover-ticket");
  if (request.method === "POST" && ticketId) {
    try { return json(response, 201, { takeover: sessions.issueTakeoverTicket(ticketId) }); } catch (error) { return json(response, 404, { error: error instanceof Error ? error.message : "NOT_FOUND" }); }
  }
  const executeId = sessionIdFor(path, "/execute");
  if (request.method === "POST" && executeId) {
    try {
      const body = await readJson(request) as ExecuteActionBody;
      if (typeof body.actionId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(body.actionId)) return json(response, 400, { error: "INVALID_ACTION_ID" });
      return json(response, 200, { result: await sessions.executeApprovedDemoAction(executeId, body.actionId) });
    } catch (error) {
      const code = error instanceof Error ? error.message : "ACTION_EXECUTE_FAILED";
      return json(response, code === "BROWSER_SESSION_NOT_FOUND" ? 404 : 409, { error: code });
    }
  }
  const closeId = sessionIdFor(path, "");
  if (request.method === "DELETE" && closeId) { await sessions.close(closeId); return response.writeHead(204).end(); }
  return json(response, 404, { error: "NOT_FOUND" });
});

server.on("upgrade", (request, socket: Socket, head) => {
  const path = parsePath(request);
  const sessionId = sessionIdFor(path, "/takeover");
  const url = new URL(request.url || "/", config.publicOrigin);
  if (!sessionId || requestOrigin(request) !== config.publicOrigin || !sessions.validateTakeoverTicket(sessionId, url.searchParams.get("ticket"), true)) return socket.destroy();
  wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request, sessionId));
});

async function stop(): Promise<void> { server.close(); await sessions.shutdown(); }
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
server.listen(config.port, "0.0.0.0", () => console.info(JSON.stringify({ level: "info", event: "browser_gateway.started", port: config.port, provider: "local", maxConcurrent: 1 })));
