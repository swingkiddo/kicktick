import { expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSsePayload } from "../../src/market/sse-normalize";
import { parseSoccerEvent } from "../../src/market/event-parser";

const samplePath = join(__dirname, "..", "..", "..", "sse_data_example");

function parseLine(line: string): Record<string, unknown> {
  const jsonStr = line.replace(/^\[\d+\]\s*/, "");
  return JSON.parse(jsonStr);
}

describe("sse-normalize", () => {
  it("maps PascalCase FixtureId to camelCase fixtureId", () => {
    const raw = parseLine(readFileSync(samplePath, "utf8").split("\n")[0]);
    const out = normalizeSsePayload(raw);
    expect(out.fixtureId).to.equal(18187298);
    expect(out.seq).to.be.greaterThan(0);
    expect(out.ts).to.be.greaterThan(0);
  });

  it("maps Action field correctly", () => {
    const raw = parseLine(readFileSync(samplePath, "utf8").split("\n")[1]);
    const out = normalizeSsePayload(raw);
    expect(out.action).to.equal("throw_in");
  });

  it("normalized event passes parseSoccerEvent for known actions", () => {
    const raw = parseLine(readFileSync(samplePath, "utf8").split("\n")[2]);
    const out = normalizeSsePayload(raw);
    const event = parseSoccerEvent(out);
    expect(event).to.not.be.null;
    expect(event!.action).to.equal("throw_in");
  });

  it("returns null for unknown actions after normalize", () => {
    const raw = { Action: "attack_possession", FixtureId: 1, Id: 1, Seq: 1, Ts: 1 };
    const out = normalizeSsePayload(raw);
    const event = parseSoccerEvent(out);
    expect(event).to.be.null;
  });

  it("preserves unknown fields in _extra", () => {
    const raw = parseLine(readFileSync(samplePath, "utf8").split("\n")[0]);
    const out = normalizeSsePayload(raw);
    expect(out._extra).to.not.be.undefined;
    expect(out._extra!.CompetitionId).to.equal(72);
    expect(out._extra!.SportId).to.equal(1);
  });

  it("handles Ts-only keepalive objects", () => {
    const raw = { Ts: 1783285684647 };
    const out = normalizeSsePayload(raw);
    expect(out.ts).to.equal(1783285684647);
    expect(out.fixtureId).to.equal(0);
    expect(out.action).to.equal("");
    expect(out._extra).to.be.undefined;
  });
});
