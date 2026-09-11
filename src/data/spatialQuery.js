/**
 * Small, dependency-free spatial primitives for point-based queries.
 *
 * Geometry model:
 * - Positions are [latitude, longitude] points on a sphere.
 * - Distance is the great-circle distance in metres.
 * - Longitude may be supplied as `lon` or `lng`.
 *
 * This deliberately does not depend on Cesium or on any entity shape. Callers
 * provide a position accessor when querying collections of arbitrary entities.
 */

const EARTH_RADIUS_M = 6_371_000;
const DEGREES_TO_RADIANS = Math.PI / 180;

function getLongitude(point) {
  return point.lon ?? point.lng;
}

function isValidPoint(point) {
  if (!point || typeof point !== 'object') return false;

  const { lat } = point;
  const lon = getLongitude(point);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function assertPoint(point, name) {
  if (!point || typeof point !== 'object') {
    throw new TypeError(
      `${name} must be an object with finite latitude and longitude`,
    );
  }

  const lon = getLongitude(point);

  if (!Number.isFinite(point.lat) || !Number.isFinite(lon)) {
    throw new TypeError(
      `${name} must contain finite latitude and longitude`,
    );
  }

  if (
    point.lat < -90 ||
    point.lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new RangeError(
      `${name} contains coordinates outside valid latitude/longitude ranges`,
    );
  }
}

/**
 * Computes spherical great-circle distance between two coordinates.
 *
 * The haversine formulation is numerically stable for small distances. The
 * input longitude difference does not need explicit dateline wrapping because
 * the sine term is periodic.
 */
function computeGreatCircleMeters(a, b) {
  const lat1 = a.lat * DEGREES_TO_RADIANS;
  const lat2 = b.lat * DEGREES_TO_RADIANS;
  const dLat = lat2 - lat1;
  const dLon =
    (getLongitude(b) - getLongitude(a)) * DEGREES_TO_RADIANS;

  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);

  const h = Math.min(
    1,
    Math.max(
      0,
      sinHalfLat * sinHalfLat +
        Math.cos(lat1) *
          Math.cos(lat2) *
          sinHalfLon *
          sinHalfLon,
    ),
  );

  return (
    EARTH_RADIUS_M *
    2 *
    Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  );
}

/**
 * Returns the spherical great-circle distance between two points in metres.
 */
export function greatCircleMeters(a, b) {
  assertPoint(a, 'a');
  assertPoint(b, 'b');

  return computeGreatCircleMeters(a, b);
}

/**
 * Finds every valid entity within radiusM of center.
 *
 * Results are ordered by ascending distance. Equal-distance results preserve
 * source order under the stable Array#sort specified by modern ECMAScript.
 * Invalid entity positions are skipped rather than making the whole query fail.
 *
 * The current implementation is intentionally a linear scan. An indexed
 * backend can replace the scan later without changing the public semantics.
 */
export function queryRadius(entities, center, radiusM, getPosition) {
  if (!Array.isArray(entities)) {
    throw new TypeError('entities must be an array');
  }

  assertPoint(center, 'center');

  if (!Number.isFinite(radiusM) || radiusM < 0) {
    throw new TypeError(
      'radiusM must be a finite, non-negative number',
    );
  }

  if (typeof getPosition !== 'function') {
    throw new TypeError('getPosition must be a function');
  }

  const matches = [];

  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];
    const position = getPosition(entity, index);

    if (!isValidPoint(position)) continue;

    const distanceM = computeGreatCircleMeters(center, position);

    if (distanceM <= radiusM) {
      matches.push({
        entity,
        distanceM,
      });
    }
  }

  matches.sort((a, b) => a.distanceM - b.distanceM);

  return matches;
}

/**
 * Returns the closest valid entity to point, or null when no valid entity
 * position is available.
 *
 * Strict `<` comparison intentionally preserves the first source entity when
 * two valid entities are exactly equally distant.
 */
export function nearest(entities, point, getPosition) {
  if (!Array.isArray(entities)) {
    throw new TypeError('entities must be an array');
  }

  assertPoint(point, 'point');

  if (typeof getPosition !== 'function') {
    throw new TypeError('getPosition must be a function');
  }

  let best = null;
  let bestDistanceM = Infinity;

  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];
    const position = getPosition(entity, index);

    if (!isValidPoint(position)) continue;

    const distanceM = computeGreatCircleMeters(point, position);

    if (distanceM < bestDistanceM) {
      best = entity;
      bestDistanceM = distanceM;
    }
  }

  return best === null
    ? null
    : {
        entity: best,
        distanceM: bestDistanceM,
      };
}
