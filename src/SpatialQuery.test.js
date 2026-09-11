import test from 'node:test';
import assert from 'node:assert/strict';

import {
  greatCircleMeters,
  nearest,
  queryRadius,
} from './src/data/spatialQuery.js';

test('greatCircleMeters returns zero for identical points', () => {
  assert.equal(
    greatCircleMeters(
      { lat: 40, lon: -73 },
      { lat: 40, lon: -73 },
    ),
    0,
  );
});

test('greatCircleMeters gives approximately 111 km for one degree of latitude', () => {
  const distanceM = greatCircleMeters(
    { lat: 0, lon: 0 },
    { lat: 1, lon: 0 },
  );

  assert.ok(distanceM > 110_000 && distanceM < 112_000);
});

test('greatCircleMeters handles dateline crossing', () => {
  const distanceM = greatCircleMeters(
    { lat: 0, lon: 179.9 },
    { lat: 0, lon: -179.9 },
  );

  assert.ok(distanceM > 20_000 && distanceM < 25_000);
});

test('greatCircleMeters handles antipodal points', () => {
  const radiusM = 6_371_000;

  const distanceM = greatCircleMeters(
    { lat: 0, lon: 0 },
    { lat: 0, lon: 180 },
  );

  assert.ok(Math.abs(distanceM - Math.PI * radiusM) < 1);
});

test('greatCircleMeters accepts lon and lng and supports mixed usage', () => {
  const usingLon = greatCircleMeters(
    { lat: 10, lon: 20 },
    { lat: 10, lon: 21 },
  );

  const usingLng = greatCircleMeters(
    { lat: 10, lng: 20 },
    { lat: 10, lng: 21 },
  );

  const mixed = greatCircleMeters(
    { lat: 10, lon: 20 },
    { lat: 10, lng: 21 },
  );

  assert.equal(usingLng, usingLon);
  assert.equal(mixed, usingLon);
});

test('queryRadius includes the exact radius boundary', () => {
  const center = { lat: 0, lon: 0 };
  const edge = { lat: 0, lon: 1 };
  const radiusM = greatCircleMeters(center, edge);

  const matches = queryRadius(
    [{ id: 'edge', position: edge }],
    center,
    radiusM,
    (entity) => entity.position,
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].entity.id, 'edge');
});

test('queryRadius orders matches from nearest to farthest', () => {
  const center = { lat: 0, lon: 0 };

  const entities = [
    { id: 'far', position: { lat: 0, lon: 2 } },
    { id: 'near', position: { lat: 0, lon: 0.5 } },
    { id: 'middle', position: { lat: 0, lon: 1 } },
  ];

  const matches = queryRadius(
    entities,
    center,
    250_000,
    (entity) => entity.position,
  );

  assert.deepEqual(
    matches.map((match) => match.entity.id),
    ['near', 'middle', 'far'],
  );
});

test('queryRadius deterministically preserves source order for equal distances', () => {
  const center = { lat: 0, lon: 0 };

  const entities = [
    { id: 'east', position: { lat: 0, lon: 1 } },
    { id: 'west', position: { lat: 0, lon: -1 } },
  ];

  const matches = queryRadius(
    entities,
    center,
    120_000,
    (entity) => entity.position,
  );

  assert.deepEqual(
    matches.map((match) => match.entity.id),
    ['east', 'west'],
  );
});

test('queryRadius supports a zero-radius exact match', () => {
  const center = { lat: 12.3, lon: 45.6 };

  const entities = [
    { id: 'same', position: center },
    { id: 'other', position: { lat: 12.3, lon: 45.7 } },
  ];

  const matches = queryRadius(
    entities,
    center,
    0,
    (entity) => entity.position,
  );

  assert.deepEqual(
    matches.map((match) => match.entity.id),
    ['same'],
  );

  assert.equal(matches[0].distanceM, 0);
});

test('queryRadius skips invalid entity coordinates', () => {
  const center = { lat: 0, lon: 0 };

  const entities = [
    { id: 'valid', position: { lat: 0, lon: 1 } },
    { id: 'bad-lat', position: { lat: 91, lon: 0 } },
    { id: 'bad-lon', position: { lat: 0, lon: 181 } },
    { id: 'missing', position: { lat: 0 } },
  ];

  const matches = queryRadius(
    entities,
    center,
    120_000,
    (entity) => entity.position,
  );

  assert.deepEqual(
    matches.map((match) => match.entity.id),
    ['valid'],
  );
});

test('queryRadius supports index-aware position accessors', () => {
  const positions = [
    { lat: 0, lon: 2 },
    { lat: 0, lon: 0.5 },
  ];

  const entities = ['first', 'second'];
  const seenIndexes = [];

  const matches = queryRadius(
    entities,
    { lat: 0, lon: 0 },
    100_000,
    (_entity, index) => {
      seenIndexes.push(index);
      return positions[index];
    },
  );

  assert.deepEqual(seenIndexes, [0, 1]);
  assert.deepEqual(
    matches.map((match) => match.entity),
    ['second'],
  );
});

test('queryRadius returns an empty array for empty input', () => {
  assert.deepEqual(
    queryRadius(
      [],
      { lat: 0, lon: 0 },
      1000,
      () => null,
    ),
    [],
  );
});

test('nearest returns the closest valid entity', () => {
  const entities = [
    { id: 'far', position: { lat: 0, lon: 2 } },
    { id: 'near', position: { lat: 0, lon: 0.25 } },
    { id: 'middle', position: { lat: 0, lon: 1 } },
  ];

  const result = nearest(
    entities,
    { lat: 0, lon: 0 },
    (entity) => entity.position,
  );

  assert.equal(result.entity.id, 'near');
  assert.ok(result.distanceM < 30_000);
});

test('nearest preserves the first entity for equal-distance ties', () => {
  const entities = [
    { id: 'east', position: { lat: 0, lon: 1 } },
    { id: 'west', position: { lat: 0, lon: -1 } },
  ];

  const result = nearest(
    entities,
    { lat: 0, lon: 0 },
    (entity) => entity.position,
  );

  assert.equal(result.entity.id, 'east');
});

test('nearest returns null for empty input and when no valid positions exist', () => {
  assert.equal(
    nearest([], { lat: 0, lon: 0 }, () => null),
    null,
  );

  assert.equal(
    nearest(
      [{ id: 'bad', position: { lat: 100, lon: 0 } }],
      { lat: 0, lon: 0 },
      (entity) => entity.position,
    ),
    null,
  );
});

test('query functions reject invalid arguments', () => {
  assert.throws(
    () =>
      greatCircleMeters(
        { lat: 0, lon: 181 },
        { lat: 0, lon: 0 },
      ),
    RangeError,
  );

  assert.throws(
    () =>
      queryRadius(
        'not-an-array',
        { lat: 0, lon: 0 },
        1,
        () => null,
      ),
    TypeError,
  );

  assert.throws(
    () =>
      queryRadius(
        [],
        { lat: 0, lon: 0 },
        Infinity,
        () => null,
      ),
    TypeError,
  );

  assert.throws(
    () =>
      nearest(
        [],
        { lat: 0, lon: 0 },
        null,
      ),
    TypeError,
  );
});

test('nearest passes entity indexes to the position accessor', () => {
  const entities = ['a', 'b'];
  const seenIndexes = [];

  const result = nearest(
    entities,
    { lat: 0, lon: 0 },
    (_entity, index) => {
      seenIndexes.push(index);

      return index === 1
        ? { lat: 0, lon: 0.1 }
        : { lat: 0, lon: 1 };
    },
  );

  assert.deepEqual(seenIndexes, [0, 1]);
  assert.equal(result.entity, 'b');
});

test('queryRadius does not mutate the source array', () => {
  const entities = [
    {
      id: 'far',
      position: { lat: 0, lon: 2 },
    },
    {
      id: 'near',
      position: { lat: 0, lon: 0.5 },
    },
  ];

  const original = [...entities];

  queryRadius(
    entities,
    { lat: 0, lon: 0 },
    250_000,
    (entity) => entity.position,
  );

  assert.deepEqual(entities, original);
});
