import { decode } from "geobuf";
import inside from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import Pbf from "pbf";

import { getTimezoneAtSea, oceanZones } from "./oceanUtils";

async function geoData(start: number, end: number) {
  const response = await fetch(
    "https://cdn.jsdelivr.net/npm/geo-tz@latest/data/timezones-1970.geojson.geo.dat",
    {
      headers: { Range: `bytes=${start}-${end}` },
    }
  );
  return await response.arrayBuffer();
}

async function tzData() {
  const response = await fetch(
    "https://cdn.jsdelivr.net/npm/geo-tz@latest/data/timezones-1970.geojson.index.json"
  );
  return await response.json();
}

let tzDataPromise: Promise<any> | null = null;

/**
 * Find the timezone ID(s) at the given GPS coordinates.
 *
 * @param lat latitude (must be >= -90 and <=90)
 * @param lon longitue (must be >= -180 and <=180)
 * @returns An array of string of TZIDs at the given coordinate.
 */
export async function find(lat: number, lon: number): Promise<string[]> {
  const originalLon = lon;

  let err;

  // validate latitude
  if (isNaN(lat) || lat > 90 || lat < -90) {
    err = new Error("Invalid latitude: " + lat);
    throw err;
  }

  // validate longitude
  if (isNaN(lon) || lon > 180 || lon < -180) {
    err = new Error("Invalid longitude: " + lon);
    throw err;
  }

  // North Pole should return all ocean zones
  if (lat === 90) {
    return oceanZones.map((zone) => zone.tzid);
  }

  // fix edges of the world
  if (lat >= 89.9999) {
    lat = 89.9999;
  } else if (lat <= -89.9999) {
    lat = -89.9999;
  }

  if (lon >= 179.9999) {
    lon = 179.9999;
  } else if (lon <= -179.9999) {
    lon = -179.9999;
  }

  const pt = point([lon, lat]);

  // get exact boundaries
  const quadData = {
    top: 89.9999,
    bottom: -89.9999,
    left: -179.9999,
    right: 179.9999,
    midLat: 0,
    midLon: 0,
  };
  let quadPos = "";
  if (!tzDataPromise) {
    tzDataPromise = tzData();
  }

  let curTzData = (await tzDataPromise).lookup;

  while (true) {
    // calculate next quadtree position
    let nextQuad;
    if (lat >= quadData.midLat && lon >= quadData.midLon) {
      nextQuad = "a";
      quadData.bottom = quadData.midLat;
      quadData.left = quadData.midLon;
    } else if (lat >= quadData.midLat && lon < quadData.midLon) {
      nextQuad = "b";
      quadData.bottom = quadData.midLat;
      quadData.right = quadData.midLon;
    } else if (lat < quadData.midLat && lon < quadData.midLon) {
      nextQuad = "c";
      quadData.top = quadData.midLat;
      quadData.right = quadData.midLon;
    } else {
      nextQuad = "d";
      quadData.top = quadData.midLat;
      quadData.left = quadData.midLon;
    }

    // console.log(nextQuad)
    curTzData = curTzData[nextQuad];
    // console.log()
    quadPos += nextQuad;

    // analyze result of current depth
    if (!curTzData) {
      // no timezone in this quad, therefore must be timezone at sea
      return getTimezoneAtSea(originalLon);
    } else if (curTzData.pos >= 0 && curTzData.len) {
      // get exact boundaries
      const bufSlice = await geoData(
        curTzData.pos,
        curTzData.pos + curTzData.len - 1
      );
      const geoJson = decode(new Pbf(bufSlice));

      const timezonesContainingPoint = [];

      if (geoJson.type === "FeatureCollection") {
        for (let i = 0; i < geoJson.features.length; i++) {
          if (inside(pt, geoJson.features[i] as any)) {
            timezonesContainingPoint.push(geoJson.features[i].properties.tzid);
          }
        }
      } else if (geoJson.type === "Feature") {
        if (inside(pt, geoJson as any)) {
          timezonesContainingPoint.push(geoJson.properties.tzid);
        }
      }

      // if at least one timezone contained the point, return those timezones,
      // otherwise must be timezone at sea
      return timezonesContainingPoint.length > 0
        ? timezonesContainingPoint
        : getTimezoneAtSea(originalLon);
    } else if (curTzData.length > 0) {
      // exact match found
      const timezones = (await tzDataPromise).timezones;
      return curTzData.map((idx) => timezones[idx]);
    } else if (typeof curTzData !== "object") {
      // not another nested quad index, throw error
      err = new Error("Unexpected data type");
      throw err;
    }

    // calculate next quadtree depth data
    quadData.midLat = (quadData.top + quadData.bottom) / 2;
    quadData.midLon = (quadData.left + quadData.right) / 2;
  }
}

export function toOffset(timeZone: string) {
  const date = new Date();
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzDate = new Date(date.toLocaleString("en-US", { timeZone }));
  return (tzDate.getTime() - utcDate.getTime()) / 6e4;
}
