import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEW_MODES,
  WORKSPACES,
  computeWorldSafeArea,
  normalizeSafeArea,
  normalizeViewMode,
  normalizeWorkspace,
  viewportCenter,
} from './operationalViewport.js';

test('normalizes unknown view/workspace values to stable defaults', () => {
  assert.equal(normalizeViewMode('unknown'), VIEW_MODES.SCOPE);
  assert.equal(normalizeWorkspace('unknown'), WORKSPACES.OPERATIONS);
});

test('computes a three-zone operational safe area', () => {
  const safe = computeWorldSafeArea(
    { width: 1600, height: 900 },
    {
      left: { left: 0, top: 80, right: 260, bottom: 820, width: 260, height: 740 },
      right: { left: 1320, top: 80, right: 1600, bottom: 820, width: 280, height: 740 },
      top: { left: 0, top: 0, right: 1600, bottom: 64, width: 1600, height: 64 },
      bottom: { left: 0, top: 840, right: 1600, bottom: 900, width: 1600, height: 60 },
    },
    { gap: 12, minWorldWidth: 420, minWorldHeight: 260 },
  );

  assert.deepEqual(safe.world, {
    x: 272,
    y: 76,
    width: 1044,
    height: 752,
  });
});

test('falls back to full viewport if panel corridors consume too much space', () => {
  const safe = computeWorldSafeArea(
    { width: 900, height: 600 },
    {
      left: { left: 0, right: 430, top: 0, bottom: 600, width: 430, height: 600 },
      right: { left: 470, right: 900, top: 0, bottom: 600, width: 430, height: 600 },
    },
    { gap: 12, minWorldWidth: 420, minWorldHeight: 260 },
  );

  assert.deepEqual(safe.world, { x: 0, y: 0, width: 900, height: 600 });
});

test('normalizes safe area into viewport coordinates', () => {
  const normalized = normalizeSafeArea({
    viewport: { width: 1000, height: 500 },
    world: { x: 100, y: 50, width: 800, height: 400 },
  });
  assert.deepEqual(normalized, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
});

test('viewportCenter returns geometric center', () => {
  assert.deepEqual(viewportCenter({ x: 100, y: 40, width: 800, height: 400 }), {
    x: 500,
    y: 240,
  });
});
