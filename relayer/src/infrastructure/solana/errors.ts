export class AnchorClientError extends Error {
  constructor(message: string, public readonly logs?: string[]) {
    super(message);
    this.name = "AnchorClientError";
  }
}
