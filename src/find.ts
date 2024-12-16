import { decode } from "geobuf";
import inside from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import Pbf from "pbf";

import { getTimezoneAtSea, oceanZones } from "./oceanUtils";

type GeoDataSource =
  | string
  | ((start: number, end: number) => Promise<ArrayBuffer>);
type TzDataSource = string | (() => Promise<any>);

/**
 * Initialize the GeoTZ module with the given data sources.
 *
 * @param geoDataSource A string of the URL of the GeoJSON data or a function that returns an ArrayBuffer given a byte range.
 * @param tzDataSource A string of the URL of the index.json data or a function that returns an object.
 * @returns An object with a find function that can be used to find the timezone ID(s) at the given GPS coordinates.
 */
export function init(
  geoDataSource: GeoDataSource = "https://cdn.jsdelivr.net/npm/geo-tz@latest/data/timezones-1970.geojson.geo.dat",
  tzDataSource: TzDataSource = "https://cdn.jsdelivr.net/npm/geo-tz@latest/data/timezones-1970.geojson.index.json",
) {
  const geoData =
    typeof geoDataSource === "string"
      ? async (start: number, end: number) => {
        const response = await fetch(geoDataSource, {
          headers: { Range: `bytes=${start}-${end}` },
        });
        return await response.arrayBuffer();
      }
      : geoDataSource;

  let tzDataPromise: Promise<any> | null = null;

  const tzData =
    typeof tzDataSource === "string"
      ? async () => {
        if (tzDataPromise) {
          return await tzDataPromise;
        }
        const promise = fetch(tzDataSource).then((response) =>
          response.json(),
        );
        tzDataPromise = promise;
        return await promise;
      }
      : tzDataSource;

  return {
    /**
     * Find the timezone ID(s) at the given GPS coordinates.
     *
     * @param lat latitude (must be >= -90 and <=90)
     * @param lon longitue (must be >= -180 and <=180)
     * @returns An array of string of TZIDs at the given coordinate.
     */
    find: async (lat: number, lon: number) => {
      return await findImpl(geoData, tzData, lat, lon);
    },
  };
}

/**
 * Find the timezone ID(s) at the given GPS coordinates. This is identical to calling
 * `init()` and then calling `find()`.
 *
 * @param lat latitude (must be >= -90 and <=90)
 * @param lon longitue (must be >= -180 and <=180)
 * @returns An array of string of TZIDs at the given coordinate.
 */
export async function find(lat: number, lon: number): Promise<string[]> {
  return await init().find(lat, lon);
}

async function findImpl(
  geoData: (start: number, end: number) => Promise<ArrayBuffer>,
  tzData: () => Promise<any>,
  lat: number,
  lon: number,
): Promise<string[]> {
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

  const tzDataResponse = await tzData();

  let curTzData = tzDataResponse.lookup;

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
        curTzData.pos + curTzData.len - 1,
      );
      const geoJson = decode(new Pbf(bufSlice));

      const timezonesContainingPoint = [];

      if (geoJson.type === "FeatureCollection") {
        for (let i = 0; i < geoJson.features.length; i++) {
          if (inside(pt, geoJson.features[i] as any)) {
            const properties = geoJson.features[i].properties;
            if (properties) {
              timezonesContainingPoint.push(properties.tzid);
            }
          }
        }
      } else if (geoJson.type === "Feature") {
        if (inside(pt, geoJson as any) && geoJson.properties) {
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
      const timezones = tzDataResponse.timezones;
      return curTzData.map((idx: number) => timezones[idx]);
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
