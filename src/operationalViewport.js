/**
 * God's Eye View — Operational Viewport
 *
 * Presentation-only controller for the world workspace.
 * It does not own Cesium, data layers, camera navigation, or panel state.
 * It exposes a small contract that lets the existing monolith remain intact
 * while adding an optional WIDE presentation beside the existing SCOPE mode.
 */

export const VIEW_MODES = Object.freeze({
  SCOPE: 'scope',
  WIDE: 'wide',
});

export const WORKSPACES = Object.freeze({
  EXPLORER: 'explorer',
  OPERATIONS: 'operations',
  CLEAN: 'clean',
});

const VALID_VIEW_MODES = new Set(Object.values(VIEW_MODES));
const VALID_WORKSPACES = new Set(Object.values(WORKSPACES));

const DEFAULTS = Object.freeze({
  viewMode: VIEW_MODES.SCOPE,
  workspace: WORKSPACES.OPERATIONS,
  minWorldWidth: 420,
  minWorldHeight: 260,
  fallbackPanelGap: 12,
  selectors: Object.freeze({
    world: '#cesiumContainer',
    scopeMask: '#scope-mask',
    scopeToggle: '#scope-toggle',
    leftRail: '#left-panel-stack',
    rightRail: '#right-context-rail',
    topBar: '#title-bar',
    topCenter: '#top-center-actions',
    bottomRail: '#timeline, #bottom-timeline, #scene-timeline',
    cockpit: '#cockpit-hud',
  }),
});

function clampFinite(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function rectOf(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function isPainted(element) {
  if (!element) return false;
  let node = element;
  while (node && node.nodeType === 1) {
    const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
    if (style) {
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
    }
    node = node.parentElement;
  }
  return true;
}

function resolveRect(documentRef, selector) {
  if (!documentRef || !selector) return null;
  const matches = String(selector)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of matches) {
    let element = null;
    try {
      element = documentRef.querySelector(part);
    } catch {
      continue;
    }
    if (element && isPainted(element)) {
      const rect = rectOf(element);
      if (rect) return rect;
    }
  }
  return null;
}

function unionRects(rects) {
  const valid = rects.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((acc, rect) => ({
    left: Math.min(acc.left, rect.left),
    top: Math.min(acc.top, rect.top),
    right: Math.max(acc.right, rect.right),
    bottom: Math.max(acc.bottom, rect.bottom),
    width: Math.max(acc.right, rect.right) - Math.min(acc.left, rect.left),
    height: Math.max(acc.bottom, rect.bottom) - Math.min(acc.top, rect.top),
  }));
}

/**
 * Compute the usable world rectangle after subtracting visible UI lanes.
 * Pure enough to unit test by supplying a synthetic viewport and lane rects.
 */
export function computeWorldSafeArea(viewport, lanes, options = {}) {
  const width = Math.max(0, Number(viewport?.width) || 0);
  const height = Math.max(0, Number(viewport?.height) || 0);
  const gap = Math.max(0, Number(options.gap) || 0);
  const minWorldWidth = Math.max(0, Number(options.minWorldWidth) || 0);
  const minWorldHeight = Math.max(0, Number(options.minWorldHeight) || 0);

  const left = lanes?.left ?? null;
  const right = lanes?.right ?? null;
  const top = lanes?.top ?? null;
  const bottom = lanes?.bottom ?? null;

  const x0 = left ? Math.max(0, left.right + gap) : 0;
  const x1 = right ? Math.min(width, right.left - gap) : width;
  const y0 = top ? Math.max(0, top.bottom + gap) : 0;
  const y1 = bottom ? Math.min(height, bottom.top - gap) : height;

  let world = {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };

  // When rails physically overlap, do not manufacture an impossible safe area.
  // Fall back to the full viewport and let callers decide how to degrade.
  if (world.width < minWorldWidth || world.height < minWorldHeight) {
    world = { x: 0, y: 0, width, height };
  }

  return Object.freeze({
    viewport: Object.freeze({ width, height }),
    world: Object.freeze(world),
    lanes: Object.freeze({ left, right, top, bottom }),
  });
}

export function normalizeViewMode(value) {
  return VALID_VIEW_MODES.has(value) ? value : VIEW_MODES.SCOPE;
}

export function normalizeWorkspace(value) {
  return VALID_WORKSPACES.has(value) ? value : WORKSPACES.OPERATIONS;
}

export function viewportCenter(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/**
 * Convert a safe-area rect into normalized screen coordinates [0,1].
 * Useful later for camera/annotation solvers without coupling them to CSS px.
 */
export function normalizeSafeArea(safeArea) {
  const vp = safeArea?.viewport;
  const world = safeArea?.world;
  if (!vp || vp.width <= 0 || vp.height <= 0) {
    return Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
  }
  return Object.freeze({
    x: world.x / vp.width,
    y: world.y / vp.height,
    width: world.width / vp.width,
    height: world.height / vp.height,
  });
}

export class OperationalViewportController {
  constructor({
    viewer = null,
    documentRef = typeof document !== 'undefined' ? document : null,
    options = {},
  } = {}) {
    this.viewer = viewer;
    this.document = documentRef;
    this.options = {
      ...DEFAULTS,
      ...options,
      selectors: {
        ...DEFAULTS.selectors,
        ...(options.selectors || {}),
      },
    };

    this.viewMode = normalizeViewMode(this.options.viewMode);
    this.workspace = normalizeWorkspace(this.options.workspace);
    this.safeArea = null;
    this._resizeObserver = null;
    this._listeners = new Set();
    this._resizeHandler = () => this.recompute();
  }

  mount() {
    this.apply();
    this._installResizeObservation();
    return this;
  }

  destroy() {
    this._resizeObserver?.disconnect?.();
    this._resizeObserver = null;
    this._listeners.clear();
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  setViewMode(mode, { silent = false } = {}) {
    const next = normalizeViewMode(mode);
    if (next === this.viewMode) return false;
    this.viewMode = next;
    this.apply({ silent });
    return true;
  }

  setWorkspace(workspace, { silent = false } = {}) {
    const next = normalizeWorkspace(workspace);
    if (next === this.workspace) return false;
    this.workspace = next;
    this.apply({ silent });
    return true;
  }

  toggleViewMode(options = {}) {
    return this.setViewMode(
      this.viewMode === VIEW_MODES.SCOPE ? VIEW_MODES.WIDE : VIEW_MODES.SCOPE,
      options,
    );
  }

  getState() {
    return Object.freeze({
      viewMode: this.viewMode,
      workspace: this.workspace,
      safeArea: this.safeArea,
    });
  }

  recompute() {
    const viewport = this._viewportRect();
    const lanes = this._measureLanes(viewport);
    this.safeArea = computeWorldSafeArea(viewport, lanes, this.options);
    this.document?.documentElement?.style?.setProperty('--gev-world-safe-x', `${this.safeArea.world.x}px`);
    this.document?.documentElement?.style?.setProperty('--gev-world-safe-y', `${this.safeArea.world.y}px`);
    this.document?.documentElement?.style?.setProperty('--gev-world-safe-width', `${this.safeArea.world.width}px`);
    this.document?.documentElement?.style?.setProperty('--gev-world-safe-height', `${this.safeArea.world.height}px`);
    this._emit();
    return this.safeArea;
  }

  apply({ silent = false } = {}) {
    const root = this.document?.documentElement;
    const body = this.document?.body;
    if (!root || !body) return;

    root.dataset.gevViewMode = this.viewMode;
    root.dataset.gevWorkspace = this.workspace;
    body.dataset.gevViewMode = this.viewMode;
    body.dataset.gevWorkspace = this.workspace;

    const toggle = this.document.querySelector(this.options.selectors.scopeToggle);
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(this.viewMode === VIEW_MODES.WIDE));
      toggle.dataset.viewMode = this.viewMode;
    }

    const scopeMask = this.document.querySelector(this.options.selectors.scopeMask);
    if (scopeMask) {
      // Keep scopeMask.js as the authority for the actual enable state.
      // This CSS fallback only controls presentation if a caller has not wired
      // the module-level setter yet.
      scopeMask.dataset.operationalViewport = this.viewMode;
    }

    this.recompute();
    if (!silent) {
      this._dispatch('gev:view-mode-changed', this.getState());
    }
  }

  _dispatch(name, detail) {
    if (typeof CustomEvent === 'function' && this.document?.defaultView) {
      this.document.defaultView.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  _emit() {
    const state = this.getState();
    for (const listener of [...this._listeners]) {
      try { listener(state); } catch (error) { console.warn('[OperationalViewport] listener failed', error); }
    }
  }

  _viewportRect() {
    const world = this.document?.querySelector(this.options.selectors.world);
    const rect = rectOf(world);
    if (rect) return { width: rect.width, height: rect.height };
    const win = this.document?.defaultView;
    return {
      width: Math.max(0, Number(win?.innerWidth) || 0),
      height: Math.max(0, Number(win?.innerHeight) || 0),
    };
  }

  _measureLanes(viewport) {
    if (this.viewMode !== VIEW_MODES.WIDE) {
      return { left: null, right: null, top: null, bottom: null };
    }

    const selectors = this.options.selectors;
    const left = resolveRect(this.document, selectors.leftRail);
    const right = resolveRect(this.document, selectors.rightRail);
    const top = unionRects([
      resolveRect(this.document, selectors.topBar),
      resolveRect(this.document, selectors.topCenter),
    ]);
    const bottom = resolveRect(this.document, selectors.bottomRail);

    // Ignore cockpit chrome when cockpit is hidden; this avoids shrinking the
    // operational world for an unrelated first-person HUD.
    const cockpit = resolveRect(this.document, selectors.cockpit);
    if (cockpit && cockpit.width > viewport.width * 0.9 && cockpit.height > viewport.height * 0.9) {
      return { left: null, right: null, top: null, bottom: null };
    }

    return { left, right, top, bottom };
  }

  _installResizeObservation() {
    if (!this.document) return;
    const world = this.document.querySelector(this.options.selectors.world);
    if (typeof ResizeObserver === 'function' && world) {
      this._resizeObserver?.disconnect?.();
      this._resizeObserver = new ResizeObserver(() => this.recompute());
      this._resizeObserver.observe(world);
      return;
    }
    this.document.defaultView?.addEventListener?.('resize', this._resizeHandler, { passive: true });
  }
}

export function createOperationalViewport(config) {
  return new OperationalViewportController(config).mount();
}

export default createOperationalViewport;
