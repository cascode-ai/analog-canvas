export class ComponentLibraryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly outcomeUnknown = false,
  ) {
    super(message);
  }
}
