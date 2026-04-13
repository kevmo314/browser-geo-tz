import { describe, expect, test, afterAll } from "vitest";
import { openSync, readSync, closeSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { init } from "../src/find";

// Locate the geo-tz package root via require.resolve so the path stays valid
// regardless of where the tests are invoked from.
const geoTzRoot = resolve(dirname(require.resolve("geo-tz")), "..");
const geoDataPath = resolve(geoTzRoot, "data/timezones-1970.geojson.geo.dat");
const tzDataPath = resolve(geoTzRoot, "data/timezones-1970.geojson.index.json");

// Open the data file once and reuse the fd across all test calls.
const geoDataFd = openSync(geoDataPath, "r");
afterAll(() => closeSync(geoDataFd));

// Use local geo-tz data files instead of CDN to make tests independent of
// network access and CDN caching behaviour.
const geoTz = init(
  (start, end) => {
    const length = end - start + 1;
    const buf = Buffer.alloc(length);
    readSync(geoDataFd, buf, 0, length, start);
    return Promise.resolve(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
  },
  () => Promise.resolve(JSON.parse(readFileSync(tzDataPath, "utf8"))),
);

describe("find", () => {
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
