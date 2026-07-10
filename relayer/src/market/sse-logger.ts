import fs from "fs";
import path from "path";

export class SseLogger {
  private readonly filePath: string;
  private count: number = 0;

  constructor(filePath: string) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  get path(): string {
    return this.filePath;
  }

  write(data: string): void {
    this.count += 1;
    fs.appendFileSync(this.filePath, `[${this.count}] ${data}\n`);
  }

  close(): void {
  }
}
