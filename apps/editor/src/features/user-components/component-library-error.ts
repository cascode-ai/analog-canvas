export class ComponentLibraryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly outcomeUnknown = false,
    readonly code?: string,
    readonly existing?: { id: string; revision: number },
  ) {
    super(message);
  }
}
