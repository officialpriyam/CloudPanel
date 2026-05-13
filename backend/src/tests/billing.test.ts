import { describe, expect, it } from "vitest";
import { calculateHourlyCharge } from "../lib/money.js";

describe("billing math", () => {
  it("keeps hourly charges as integer minor units", () => {
    expect(calculateHourlyCharge(199)).toBe(199);
    expect(calculateHourlyCharge(199, 2)).toBe(398);
  });
});
