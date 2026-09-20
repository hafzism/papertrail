import { NextResponse } from "next/server";
import { getIntegrationStatus } from "../../../src/server/integration-status";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({
    data: {
      service: "web",
      status: "ok",
      integrations: getIntegrationStatus(),
    },
    requestId: crypto.randomUUID(),
  });
}
