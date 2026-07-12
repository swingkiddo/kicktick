import { expect } from "chai";
import { MarketType, MarketTrigger } from "../src/market/triggers";

describe("MarketTrigger synthetic market deadlines", () => {
  it("does not timeout a newly registered market when its deadline is in seconds converted to milliseconds", () => {
    const trigger = new MarketTrigger();
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 120;

    trigger.registerSyntheticMarket(42, 0, MarketType.GoalInWindow, expiresAtSeconds * 1000);

    expect(trigger.checkTimeouts(42)).to.deep.equal([]);
  });
});
