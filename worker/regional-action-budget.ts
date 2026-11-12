// A domestic maintenance hold can consume 60 seconds before execution starts.
// Commands retain their receipt and live-session checks throughout this budget.
export const REGIONAL_ACTION_TIMEOUT_MS = 120_000;
