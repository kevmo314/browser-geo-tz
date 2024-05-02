import { describe, expect, test } from "vitest";
import { find, init } from "../src/find";

describe("find", () => {
  const geoTz = init();
  test("America/Los_Angeles", async () => {
    const tz = await geoTz.find(37.3861, -122.0839);
    expect(tz).toEqual(["America/Los_Angeles"]);
  });

  test("America/New_York", async () => {
    const tz = await geoTz.find(40.7128, -74.006);
    expect(tz).toEqual(["America/New_York"]);
  });

  test("Asia/Tokyo", async () => {
    const tz = await geoTz.find(35.6894, 139.6917);
    expect(tz).toEqual(["Asia/Tokyo"]);
  });

  test("Europe/London", async () => {
    const tz = await geoTz.find(51.5074, -0.1278);
    expect(tz).toEqual(["Europe/London"]);
  });

  test("America/Indiana/Tell_City", async () => {
    const tz = await geoTz.find(38.08122, -86.45791);
    expect(tz).toEqual(["America/Indiana/Tell_City"]);
  });
});
