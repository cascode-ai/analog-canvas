/** Internal scheduling signal, never a successful download receipt. */
export class TransferPending extends Error {
  constructor(readonly retryAfterMs: number) {
    super("ARTIFACT_TRANSFER_PENDING");
  }
}
