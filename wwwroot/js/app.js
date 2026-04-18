class WindowManager {
    constructor() {
        this.windows = new Map();
        this.container = document.getElementById('workspace') || document.body;
        this.ws = null;

        // ── Event Bus ──
        this._listeners = {};

        // ── Renderer Registry ──
        this.renderers = new Map();
        this._typeMap = ['text', 'image', 'video', 'html'];

        // Register default renderers
        this.registerRenderer('text', (container, state) => {
            const p = document.createElement('p');
            p.innerText = state.Content;
            container.appendChild(p);
        });

        this.registerRenderer('image', (container, state) => {
            const img = document.createElement('img');
            img.src = state.Content;
            container.appendChild(img);
        });

        this.registerRenderer('video', (container, state) => {
            const video = document.createElement('video');
            video.src = state.Content;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            container.appendChild(video);
        });

        this.registerRenderer('html', (container, state) => {
            container.innerHTML = state.Content;
        });

        // ── Message Handler Registry ──
        this._messageHandlers = new Map();

        // Register default message handlers
        this.registerMessageHandler('state', (payload) => {
            this.syncWindows(payload.Windows);
        });

        this.dragState = {
            isDragging: false,
            element: null,
            startX: 0,
            startY: 0,
            offsetX: 0,
            offsetY: 0
        };

        this.resizeState = {
            isResizing: false,
            element: null,
            direction: '',
            startX: 0,
            startY: 0,
            startWidth: 0,
            startHeight: 0,
            startLeft: 0,
            startTop: 0
        };

        this.gridSize = 20;  // 0 to disable snap-to-grid
        this.minWindowWidth = 280;
        this.minWindowHeight = 200;

        this.initDragListeners();
        this.connectWebSocket();
    }

    // ═══════════════════════════════════════════════════════════
    // Event Bus — on / off / emit
    // ═══════════════════════════════════════════════════════════

    /**
     * Subscribe to an event.
     * @param {string} event - Event name (e.g. 'window:created', 'window:removed')
     * @param {Function} fn  - Callback receiving event data
     * @returns {WindowManager} this (chainable)
     */
    on(event, fn) {
        (this._listeners[event] ??= []).push(fn);
        return this;
    }

    /**
     * Unsubscribe from an event.
     * @param {string} event - Event name
     * @param {Function} fn  - The same function reference passed to on()
     * @returns {WindowManager} this (chainable)
     */
    off(event, fn) {
        const list = this._listeners[event];
        if (list) this._listeners[event] = list.filter(f => f !== fn);
        return this;
    }

    /**
     * Emit an event, calling all registered listeners.
     * @param {string} event - Event name
     * @param {*} data       - Payload passed to each listener
     */
    emit(event, data) {
        (this._listeners[event] ?? []).forEach(fn => {
            try { fn(data); } catch (e) { console.error(`Event handler error [${event}]:`, e); }
        });
    }

    // ═══════════════════════════════════════════════════════════
    // Renderer Registry
    // ═══════════════════════════════════════════════════════════

    /**
     * Register a custom renderer for a window type.
     * @param {string} typeName   - Type identifier (e.g. 'text', 'markdown', 'chart')
     * @param {Function} renderFn - (container: HTMLElement, state: object) => void
     */
    registerRenderer(typeName, renderFn) {
        this.renderers.set(typeName.toLowerCase(), renderFn);
    }

    /**
     * Resolve the string type name from a window state object.
     * Prefers TypeName (string) if the server provides it; falls back to ordinal mapping.
     * @param {object} state - Window state from the server
     * @returns {string}
     */
    resolveTypeName(state) {
        if (state.TypeName) return state.TypeName.toLowerCase();
        return this._typeMap[state.Type] ?? 'unknown';
    }

    // ═══════════════════════════════════════════════════════════
    // Message Handler Registry
    // ═══════════════════════════════════════════════════════════

    /**
     * Register a handler for a specific inbound WebSocket message type.
     * @param {string} type      - Message type (e.g. 'state', 'notification')
     * @param {Function} handler - (payload: object, version: number) => void
     */
    registerMessageHandler(type, handler) {
        this._messageHandlers.set(type, handler);
    }

    // ═══════════════════════════════════════════════════════════
    // WebSocket
    // ═══════════════════════════════════════════════════════════

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        this.ws = new WebSocket(`${protocol}//${host}/ws`);

        this.ws.onopen = () => {
            console.log("WebSocket connected.");
            const pids = Array.from(this.windows.keys());
            this.ws.send(JSON.stringify({
                Type: 'hello',
                Version: 1,
                Payload: { ProcessIds: pids }
            }));
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const type = data.Type;
                const version = data.Version ?? 0;
                // Prefer nested Payload; fall back to top-level for legacy format
                const payload = data.Payload ?? data;

                const handler = this._messageHandlers.get(type);
                if (handler) {
                    handler(payload, version);
                } else {
                    console.warn(`No handler registered for WS message type: "${type}"`);
                }
            } catch (e) {
                console.error("Error parsing WS message:", e);
            }
        };

        this.ws.onclose = () => {
            console.warn("WebSocket disconnected. Reconnecting in 3 seconds...");
            setTimeout(() => this.connectWebSocket(), 3000);
        };
        
        this.ws.onerror = (err) => {
            console.error("WebSocket error", err);
            this.ws.close();
        };
    }

    // ═══════════════════════════════════════════════════════════
    // Window Sync
    // ═══════════════════════════════════════════════════════════

    syncWindows(serverWindows) {
        const serverIds = new Set();

        serverWindows.forEach(sw => {
            serverIds.add(sw.ProcessId);
            if (this.windows.has(sw.ProcessId)) {
                this.updateWindow(sw);
            } else {
                this.createWindow(sw);
            }
        });

        for (const [pid, el] of this.windows.entries()) {
            if (!serverIds.has(pid)) {
                el.remove();
                this.windows.delete(pid);
                this.emit('window:removed', { processId: pid });
            }
        }
    }

    createWindow(state) {
        const typeName = this.resolveTypeName(state);

        const winEl = document.createElement('div');
        winEl.className = 'holo-window';
        winEl.id = `win-${state.ProcessId}`;
        winEl.dataset.pid = state.ProcessId;
        winEl.dataset.typeName = typeName;
        
        const header = document.createElement('div');
        header.className = 'window-header';

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'window-icon');
        icon.setAttribute('viewBox', '0 0 24 24');
        const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        iconPath.setAttribute('d', 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z');
        iconPath.setAttribute('fill', 'currentColor');
        icon.appendChild(iconPath);
        
        const title = document.createElement('span');
        title.className = 'window-title';
        title.innerText = `${typeName.charAt(0).toUpperCase() + typeName.slice(1)} UI`;
        
        const controls = document.createElement('div');
        controls.className = 'window-controls';
        
        const minimizeBtn = document.createElement('div');
        minimizeBtn.className = 'window-btn';
        
        const closeBtn = document.createElement('div');
        closeBtn.className = 'window-btn close';
        closeBtn.onclick = () => this.requestCloseWindow(state.ProcessId);
        
        controls.appendChild(minimizeBtn);
        controls.appendChild(closeBtn);

        header.appendChild(icon);
        header.appendChild(title);
        header.appendChild(controls);
        winEl.appendChild(header);

        const content = document.createElement('div');
        content.className = 'window-body';
        this.renderContent(content, state);
        winEl.appendChild(content);

        this._applyStyles(winEl, state);

        // Add resize handles (8 directions)
        ['n','s','e','w','ne','nw','se','sw'].forEach(dir => {
            const handle = document.createElement('div');
            handle.className = 'resize-handle';
            handle.dataset.dir = dir;
            handle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.startResize(e, winEl, dir);
            });
            winEl.appendChild(handle);
        });

        this.container.appendChild(winEl);
        this.windows.set(state.ProcessId, winEl);

        header.addEventListener('mousedown', (e) => this.startDrag(e, winEl));

        // Wire minimize button
        minimizeBtn.onclick = () => {
            this.emit('window:minimized', { processId: state.ProcessId });
        };

        this.emit('window:created', { processId: state.ProcessId, typeName, state });
    }

    renderContent(container, state) {
        container.innerHTML = '';

        const typeName = this.resolveTypeName(state);
        const renderer = this.renderers.get(typeName);

        if (renderer) {
            renderer(container, state);
        } else {
            const p = document.createElement('p');
            p.style.color = 'rgba(255,170,0,0.7)';
            p.innerText = `Unknown window type: ${typeName}`;
            container.appendChild(p);
            console.warn(`No renderer registered for window type "${typeName}"`);
        }
    }

    updateWindow(state) {
        const winEl = this.windows.get(state.ProcessId);
        if (!winEl) return;
        
        // Don't overwrite positions while user is interacting
        if (this.dragState.element === winEl || this.resizeState.element === winEl) return;

        this._applyStyles(winEl, state);
    }

    _applyStyles(winEl, state) {
        const x = state.X !== undefined ? state.X : state.x;
        const y = state.Y !== undefined ? state.Y : state.y;
        const w = state.Width !== undefined ? state.Width : state.width;
        const h = state.Height !== undefined ? state.Height : state.height;
        const z = state.ZIndex !== undefined ? state.ZIndex : state.zIndex;
        const isActive = state.IsActive !== undefined ? state.IsActive : state.isActive;

        winEl.style.left = `${x}px`;
        winEl.style.top = `${y}px`;
        winEl.style.width = `${w}px`;
        winEl.style.height = `${h}px`;
        winEl.style.zIndex = z;
        
        if (isActive) {
            winEl.classList.add('focused');
        } else {
            winEl.classList.remove('focused');
        }
    }

    requestCloseWindow(pid) {
        fetch(`/api/ai/windows/${pid}`, {
            method: 'DELETE'
        }).catch(err => console.error("Error closing window:", err));
    }

    // ═══════════════════════════════════════════════════════════
    // Drag System
    // ═══════════════════════════════════════════════════════════

    initDragListeners() {
        document.addEventListener('mousemove', (e) => {
            this.onDrag(e);
            this.onResize(e);
        });
        document.addEventListener('mouseup', () => {
            this.stopDrag();
            this.stopResize();
        });
    }

    startDrag(e, element) {
        if (this.resizeState.isResizing) return;
        this.dragState.isDragging = true;
        this.dragState.element = element;
        this.dragState.startX = e.clientX;
        this.dragState.startY = e.clientY;
        
        let targetLeft = parseInt(element.style.left, 10) || 0;
        let targetTop = parseInt(element.style.top, 10) || 0;

        this.dragState.offsetX = e.clientX - targetLeft;
        this.dragState.offsetY = e.clientY - targetTop;

        const maxZ = Math.max(...Array.from(this.windows.values()).map(el => parseInt(el.style.zIndex || 0)), 0);
        element.style.zIndex = maxZ + 1;
        element.classList.add('focused');

        this.emit('window:focused', { processId: element.dataset.pid });
    }

    onDrag(e) {
        if (!this.dragState.isDragging || !this.dragState.element) return;
        
        const x = e.clientX - this.dragState.offsetX;
        const y = e.clientY - this.dragState.offsetY;

        this.dragState.element.style.left = `${x}px`;
        this.dragState.element.style.top = `${y}px`;
    }

    stopDrag() {
        if (!this.dragState.isDragging) return;

        const el = this.dragState.element;
        const pid = el.dataset.pid;
        let x = parseInt(el.style.left, 10);
        let y = parseInt(el.style.top, 10);
        const w = parseInt(el.style.width, 10);
        const h = parseInt(el.style.height, 10);
        const z = parseInt(el.style.zIndex, 10);

        // Snap to grid
        x = this.snapToGrid(x);
        y = this.snapToGrid(y);

        // Clamp to workspace
        const clamped = this.clampToWorkspace(x, y, w, h);
        x = clamped.x;
        y = clamped.y;

        el.style.left = `${x}px`;
        el.style.top = `${y}px`;

        this._sendGeometry(pid, x, y, w, h, z);

        this.emit('window:moved', { processId: pid, x, y, zIndex: z });

        this.dragState.isDragging = false;
        this.dragState.element.classList.remove('focused');
        this.dragState.element = null;
    }

    // ═══════════════════════════════════════════════════════════
    // Resize System
    // ═══════════════════════════════════════════════════════════

    startResize(e, element, direction) {
        e.preventDefault();
        this.resizeState.isResizing = true;
        this.resizeState.element = element;
        this.resizeState.direction = direction;
        this.resizeState.startX = e.clientX;
        this.resizeState.startY = e.clientY;
        this.resizeState.startWidth = parseInt(element.style.width, 10) || element.offsetWidth;
        this.resizeState.startHeight = parseInt(element.style.height, 10) || element.offsetHeight;
        this.resizeState.startLeft = parseInt(element.style.left, 10) || 0;
        this.resizeState.startTop = parseInt(element.style.top, 10) || 0;

        element.classList.add('resizing');

        const maxZ = Math.max(...Array.from(this.windows.values()).map(el => parseInt(el.style.zIndex || 0)), 0);
        element.style.zIndex = maxZ + 1;
    }

    onResize(e) {
        if (!this.resizeState.isResizing || !this.resizeState.element) return;

        const { element, direction, startX, startY, startWidth, startHeight, startLeft, startTop } = this.resizeState;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        // Horizontal
        if (direction.includes('e')) {
            newWidth = Math.max(this.minWindowWidth, startWidth + dx);
        }
        if (direction.includes('w')) {
            newWidth = Math.max(this.minWindowWidth, startWidth - dx);
            newLeft = startLeft + (startWidth - newWidth);
        }

        // Vertical
        if (direction.includes('s')) {
            newHeight = Math.max(this.minWindowHeight, startHeight + dy);
        }
        if (direction.includes('n')) {
            newHeight = Math.max(this.minWindowHeight, startHeight - dy);
            newTop = startTop + (startHeight - newHeight);
        }

        element.style.width = `${newWidth}px`;
        element.style.height = `${newHeight}px`;
        element.style.left = `${newLeft}px`;
        element.style.top = `${newTop}px`;
    }

    stopResize() {
        if (!this.resizeState.isResizing) return;

        const el = this.resizeState.element;
        const pid = el.dataset.pid;

        let x = parseInt(el.style.left, 10);
        let y = parseInt(el.style.top, 10);
        let w = parseInt(el.style.width, 10);
        let h = parseInt(el.style.height, 10);
        const z = parseInt(el.style.zIndex, 10);

        // Snap dimensions to grid
        x = this.snapToGrid(x);
        y = this.snapToGrid(y);
        w = this.snapToGrid(w);
        h = this.snapToGrid(h);

        // Enforce minimums after snapping
        w = Math.max(this.minWindowWidth, w);
        h = Math.max(this.minWindowHeight, h);

        // Clamp to workspace
        const clamped = this.clampToWorkspace(x, y, w, h);
        x = clamped.x;
        y = clamped.y;

        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;

        el.classList.remove('resizing');

        this._sendGeometry(pid, x, y, w, h, z);

        this.emit('window:resized', { processId: pid, x, y, width: w, height: h });

        this.resizeState.isResizing = false;
        this.resizeState.element = null;
    }

    // ═══════════════════════════════════════════════════════════
    // Grid Snapping & Workspace Clamping
    // ═══════════════════════════════════════════════════════════

    /**
     * Snap a value to the nearest grid increment. Returns the value unchanged if gridSize is 0.
     */
    snapToGrid(value) {
        if (!this.gridSize) return value;
        return Math.round(value / this.gridSize) * this.gridSize;
    }

    /**
     * Clamp a window's position so it stays within the workspace.
     * Allows partial overflow (header must remain visible) so windows can be tucked to edges.
     */
    clampToWorkspace(x, y, w, h) {
        const ws = this.container.getBoundingClientRect();
        const minVisible = 48; // At least header height visible

        x = Math.max(-w + minVisible, Math.min(x, ws.width - minVisible));
        y = Math.max(0, Math.min(y, ws.height - minVisible));

        return { x, y };
    }

    // ═══════════════════════════════════════════════════════════
    // WebSocket Geometry Sync
    // ═══════════════════════════════════════════════════════════

    /**
     * Send a geometry update (position + dimensions) to the server.
     */
    _sendGeometry(pid, x, y, w, h, z) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                Type: 'windowMoved',
                Version: 1,
                Payload: { ProcessId: pid, X: x, Y: y, Width: w, Height: h, ZIndex: z }
            }));
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const isDemo = new URLSearchParams(window.location.search).has('demo');

    if (!isDemo) {
        try {
            const authRes = await fetch('/api/auth/status');
            const auth = await authRes.json();
            if (!auth.authenticated) {
                window.location.href = '/setup.html';
                return;
            }
            const operatorEl = document.getElementById('operator-name');
            if (operatorEl && auth.userName) {
                operatorEl.textContent = auth.userName.toUpperCase();
            }
        } catch (e) {
            window.location.href = '/setup.html';
            return;
        }
    } else {
        // Demo mode — skip auth, set operator label
        const operatorEl = document.getElementById('operator-name');
        if (operatorEl) operatorEl.textContent = 'DEMO';
    }

    window.vegaManager = new WindowManager();

    // Logoff button
    document.getElementById('btn-logoff')?.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/setup.html';
    });

    // ═══════════════════════════════════════════════════════════
    // Demo / Debug Toolbar
    // ═══════════════════════════════════════════════════════════
    if (isDemo) {
        initDemoToolbar(window.vegaManager);
    }
});

// ═══════════════════════════════════════════════════════════════
// Demo Toolbar Module
// ═══════════════════════════════════════════════════════════════

function initDemoToolbar(manager) {
    const themes = ['', 'amber', 'crimson'];
    let themeIdx = 0;

    // ── Create toolbar DOM ──
    const toolbar = document.createElement('div');
    toolbar.id = 'demo-toolbar';
    toolbar.innerHTML = `
        <div class="demo-toolbar-header" id="demo-toolbar-drag">
            <span class="demo-toolbar-title">⚙ DEBUG PANEL</span>
            <span class="demo-toolbar-badge">DEMO MODE</span>
        </div>
        <div class="demo-toolbar-section">
            <div class="demo-toolbar-label">SPAWN WINDOWS</div>
            <div class="demo-toolbar-grid">
                <button class="demo-btn" data-type="0" title="Text Window">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" fill="currentColor"/></svg>
                    TEXT
                </button>
                <button class="demo-btn" data-type="3" title="HTML Window">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" fill="currentColor"/></svg>
                    HTML
                </button>
                <button class="demo-btn" data-type="0" data-variant="long" title="Long Content">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z" fill="currentColor"/></svg>
                    SCROLL
                </button>
                <button class="demo-btn" data-type="3" data-variant="chart" title="Chart Demo">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z" fill="currentColor"/></svg>
                    CHART
                </button>
            </div>
        </div>
        <div class="demo-toolbar-section">
            <div class="demo-toolbar-label">CONTROLS</div>
            <div class="demo-toolbar-grid">
                <button class="demo-btn" id="demo-theme" title="Cycle Theme">🎨 THEME</button>
                <button class="demo-btn" id="demo-grid" title="Toggle Snap-to-Grid">⊞ GRID: ON</button>
                <button class="demo-btn demo-btn-danger" id="demo-clear" title="Close All Windows">✕ CLEAR</button>
                <button class="demo-btn" id="demo-batch" title="Spawn 4 Windows">⧉ BATCH</button>
            </div>
        </div>
        <div class="demo-toolbar-section">
            <div class="demo-toolbar-label">STATE</div>
            <div class="demo-toolbar-state">
                <div>Windows: <span id="demo-win-count">0</span></div>
                <div>Grid: <span id="demo-grid-val">20px</span></div>
                <div>Theme: <span id="demo-theme-val">holo</span></div>
            </div>
        </div>
    `;
    document.body.appendChild(toolbar);

    // ── Demo content templates ──
    const templates = {
        text: 'VEGA System Status Report\n\nAll subsystems operational. Holographic projection matrix calibrated.\nQuantum uplink bandwidth: 847 Gbps\nNeural interface latency: 0.3ms\n\nOperator clearance: LEVEL 5\nSession duration: ACTIVE',

        long: 'VEGA TECHNICAL SPECIFICATIONS\n\n' +
              Array.from({length: 40}, (_, i) =>
                  `[${String(i+1).padStart(3, '0')}] Subsystem ${String.fromCharCode(65 + i % 26)}-${Math.floor(i/26 + 1)}: ` +
                  ['NOMINAL', 'ACTIVE', 'STANDBY', 'CALIBRATING'][i % 4] +
                  ` — Load: ${(Math.random() * 100).toFixed(1)}%`
              ).join('\n'),

        html: `<div style="font-family: var(--font-ui); color: var(--holo-primary);">
            <h3 style="font-family: var(--font-display); font-size: 12px; letter-spacing: 3px; margin-bottom: 12px; color: var(--holo-accent);">SYSTEM DIAGNOSTICS</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div style="background: rgba(0,60,120,0.2); padding: 10px; border: 1px solid var(--holo-border); border-radius: 3px;">
                    <div style="font-size: 10px; opacity: 0.5; letter-spacing: 2px;">CPU LOAD</div>
                    <div style="font-size: 24px; font-family: var(--font-display); color: var(--holo-accent);">23%</div>
                    <div style="height: 3px; background: rgba(0,60,120,0.3); border-radius: 2px; margin-top: 4px;">
                        <div style="height: 100%; width: 23%; background: var(--holo-accent); border-radius: 2px;"></div>
                    </div>
                </div>
                <div style="background: rgba(0,60,120,0.2); padding: 10px; border: 1px solid var(--holo-border); border-radius: 3px;">
                    <div style="font-size: 10px; opacity: 0.5; letter-spacing: 2px;">MEMORY</div>
                    <div style="font-size: 24px; font-family: var(--font-display); color: var(--holo-primary);">61%</div>
                    <div style="height: 3px; background: rgba(0,60,120,0.3); border-radius: 2px; margin-top: 4px;">
                        <div style="height: 100%; width: 61%; background: var(--holo-primary); border-radius: 2px;"></div>
                    </div>
                </div>
                <div style="background: rgba(0,60,120,0.2); padding: 10px; border: 1px solid var(--holo-border); border-radius: 3px;">
                    <div style="font-size: 10px; opacity: 0.5; letter-spacing: 2px;">NETWORK</div>
                    <div style="font-size: 24px; font-family: var(--font-display); color: var(--holo-accent);">847</div>
                    <div style="font-size: 9px; opacity: 0.4;">Gbps</div>
                </div>
                <div style="background: rgba(0,60,120,0.2); padding: 10px; border: 1px solid var(--holo-border); border-radius: 3px;">
                    <div style="font-size: 10px; opacity: 0.5; letter-spacing: 2px;">UPTIME</div>
                    <div style="font-size: 24px; font-family: var(--font-display); color: var(--holo-warning);">99.7%</div>
                    <div style="font-size: 9px; opacity: 0.4;">30d average</div>
                </div>
            </div>
        </div>`,

        chart: `<div style="font-family: var(--font-ui); color: var(--holo-primary); padding: 4px;">
            <h3 style="font-family: var(--font-display); font-size: 11px; letter-spacing: 3px; margin-bottom: 16px; color: var(--holo-accent);">POWER OUTPUT — LAST 12H</h3>
            <div style="display: flex; align-items: flex-end; gap: 6px; height: 120px; padding: 0 4px;">
                ${Array.from({length: 24}, (_, i) => {
                    const h = 20 + Math.random() * 80;
                    const isHigh = h > 70;
                    return `<div style="flex:1; height:${h}%; background: linear-gradient(to top, ${isHigh ? 'var(--holo-warning)' : 'var(--holo-accent)'}, rgba(0,255,170,0.1)); border-radius: 2px 2px 0 0; min-width: 4px; opacity: 0.7; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'"></div>`;
                }).join('')}
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 9px; opacity: 0.4; font-family: var(--font-mono);">
                <span>12:00</span><span>18:00</span><span>00:00</span><span>06:00</span><span>NOW</span>
            </div>
        </div>`
    };

    // ── Spawn window helper ──
    async function spawnWindow(type, content, width = 400, height = 300) {
        try {
            await fetch('/api/ai/windows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ Type: type, Content: content, Width: width, Height: height })
            });
        } catch (e) {
            console.error('Failed to spawn window:', e);
        }
    }

    // ── Button handlers ──
    toolbar.querySelectorAll('.demo-btn[data-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = parseInt(btn.dataset.type);
            const variant = btn.dataset.variant;

            if (type === 0 && variant === 'long') {
                spawnWindow(0, templates.long, 500, 400);
            } else if (type === 0) {
                spawnWindow(0, templates.text, 420, 280);
            } else if (type === 3 && variant === 'chart') {
                spawnWindow(3, templates.chart, 480, 260);
            } else if (type === 3) {
                spawnWindow(3, templates.html, 440, 340);
            }
        });
    });

    // Theme cycling
    document.getElementById('demo-theme').addEventListener('click', () => {
        themeIdx = (themeIdx + 1) % themes.length;
        const theme = themes[themeIdx];
        if (theme) {
            document.documentElement.dataset.theme = theme;
        } else {
            delete document.documentElement.dataset.theme;
        }
        document.getElementById('demo-theme-val').textContent = theme || 'holo';
    });

    // Grid toggle
    document.getElementById('demo-grid').addEventListener('click', () => {
        manager.gridSize = manager.gridSize ? 0 : 20;
        const btn = document.getElementById('demo-grid');
        btn.textContent = manager.gridSize ? '⊞ GRID: ON' : '⊞ GRID: OFF';
        document.getElementById('demo-grid-val').textContent = manager.gridSize ? '20px' : 'off';
    });

    // Clear all
    document.getElementById('demo-clear').addEventListener('click', async () => {
        const windows = await fetch('/api/ai/windows').then(r => r.json());
        for (const w of windows) {
            await fetch(`/api/ai/windows/${w.ProcessId || w.processId}`, { method: 'DELETE' });
        }
    });

    // Batch spawn
    document.getElementById('demo-batch').addEventListener('click', async () => {
        await spawnWindow(0, templates.text, 400, 260);
        await spawnWindow(3, templates.html, 440, 340);
        await spawnWindow(3, templates.chart, 480, 240);
        await spawnWindow(0, templates.long, 380, 360);
    });

    // ── Live window count ──
    const countEl = document.getElementById('demo-win-count');
    setInterval(() => {
        countEl.textContent = manager.windows.size;
    }, 500);

    // ── Make toolbar draggable ──
    const dragHandle = document.getElementById('demo-toolbar-drag');
    let isDragging = false, dragOffX = 0, dragOffY = 0;
    dragHandle.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = toolbar.getBoundingClientRect();
        dragOffX = e.clientX - rect.left;
        dragOffY = e.clientY - rect.top;
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        toolbar.style.right = 'auto';
        toolbar.style.left = `${e.clientX - dragOffX}px`;
        toolbar.style.top = `${e.clientY - dragOffY}px`;
    });
    document.addEventListener('mouseup', () => { isDragging = false; });
}
