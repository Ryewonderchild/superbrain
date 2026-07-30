import { estimateReservation, estimateTokens } from "./token-budget.js";
import { releaseTokens, reserveTokens, settleTokens } from "./token-ledger.js";
import { calculateModelCost } from "./model-policy.js";

export async function runMeteredModelCall({
  userId,
  workspaceId = null,
  operation,
  model,
  input,
  maxOutputTokens = 0,
  execute
}) {
  const reservation = await reserveTokens({
    userId,
    workspaceId,
    operation,
    model,
    tokens: estimateReservation({ input, maxOutputTokens })
  });
  let reportedUsage = null;
  try {
    const result = await execute((usage) => {
      reportedUsage = usage;
    });
    const fallbackOutput = estimateTokens(typeof result === "string" ? result : JSON.stringify(result ?? ""));
    const usage = reportedUsage && (reportedUsage.inputTokens || reportedUsage.outputTokens)
      ? reportedUsage
      : { inputTokens: estimateTokens(input), outputTokens: fallbackOutput };
    const actualCost = calculateModelCost(model, usage);
    if (actualCost !== null) usage.actualCost = actualCost;
    const settlement = await settleTokens(reservation.id, usage);
    return { result, usage, settlement };
  } catch (error) {
    await releaseTokens(reservation.id).catch(() => {});
    throw error;
  }
}
