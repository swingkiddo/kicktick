export class MalformedScoreUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedScoreUpdateError";
  }
}
