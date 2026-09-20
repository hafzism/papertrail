import type { TokenUsage } from "@papertrail/ai";
import type { BudgetGateway, ReservationInput } from "@papertrail/ai";
import type { SqlExecutor } from "./worker-repository.js";

/** Converts application budget admission into the database's atomic reservation functions. */
export class PostgresBudgetGateway implements BudgetGateway {
  constructor(private readonly sql: SqlExecutor) {}

  async reserve(input: ReservationInput): Promise<{ reservationId: string }> {
    const rows = await this.sql.unsafe<Array<{ reservation_id: string }>>(
      "select public.reserve_budget($1::uuid, $2, $3::uuid, $4::uuid, $5, $6::bigint, $7) as reservation_id",
      [input.campaignId, input.category, input.ownerId, input.runId, input.provider, input.amountNano, input.providerRequestId],
    );
    const reservationId = rows[0]?.reservation_id;
    if (reservationId === undefined) throw new Error("Budget reservation did not return an ID.");
    return { reservationId };
  }

  async settle(input: { reservationId: string; actualNano: bigint; usage: TokenUsage }): Promise<void> {
    await this.sql.unsafe("select public.settle_budget_reservation($1::uuid, $2::bigint, $3::text::jsonb)", [input.reservationId, input.actualNano, JSON.stringify(input.usage)]);
  }

  async markChargeUncertain(reservationId: string): Promise<void> {
    await this.sql.unsafe("select public.mark_budget_charge_uncertain($1::uuid)", [reservationId]);
  }
}
