// ═══════════════════════════════════════════════════════════════
// VEGA — Starfield Background Module
// Reusable parallax starfield with nebulae, grid overlay,
// and mouse-driven parallax. Attach to any <canvas> element.
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize the starfield background on a canvas element.
 *
 * @param {string} canvasId  - The ID of the <canvas> element
 * @param {object} [options] - Configuration overrides
 * @param {number} [options.starCount=250]          - Number of stars
 * @param {number} [options.nebulaCount=4]          - Number of nebula blobs
 * @param {number} [options.parallaxStrength=20]    - Star parallax intensity
 * @param {number} [options.nebulaStrength=35]      - Nebula parallax intensity
 * @param {number} [options.gridSize=80]            - Grid cell size (px), 0 to disable
 * @param {string} [options.bgColor='#000810']      - Canvas clear color
 * @param {number} [options.nebulaHueMin=190]       - Minimum nebula hue
 * @param {number} [options.nebulaHueRange=40]      - Nebula hue variation
 * @returns {{ stop: Function, canvas: HTMLCanvasElement } | null}
 */
function initStarfield(canvasId, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');

    // Merge defaults
    const cfg = {
        starCount: 250,
        nebulaCount: 4,
        parallaxStrength: 20,
        nebulaStrength: 35,
        gridSize: 80,
        bgColor: '#000810',
        nebulaHueMin: 190,
        nebulaHueRange: 40,
        ...options
    };

    let animId = null;
    let running = true;

    // ── Mouse tracking ──
    let mouseX = 0.5, mouseY = 0.5;
    let smoothX = 0.5, smoothY = 0.5;

    const onMouseMove = (e) => {
        mouseX = e.clientX / window.innerWidth;
        mouseY = e.clientY / window.innerHeight;
    };
    document.addEventListener('mousemove', onMouseMove);

    // ── Resize ──
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    // ── Generate stars ──
    const stars = [];
    for (let i = 0; i < cfg.starCount; i++) {
        stars.push({
            baseX: Math.random() * canvas.width,
            baseY: Math.random() * canvas.height,
            x: 0, y: 0,
            r: Math.random() * 1.5 + 0.3,
            brightness: Math.random(),
            twinkleSpeed: Math.random() * 0.02 + 0.005,
            depth: Math.random() * 0.7 + 0.3
        });
    }

    // ── Generate nebulae ──
    const nebulae = [];
    for (let i = 0; i < cfg.nebulaCount; i++) {
        nebulae.push({
            baseX: Math.random() * canvas.width,
            baseY: Math.random() * canvas.height,
            x: 0, y: 0,
            r: Math.random() * 200 + 100,
            hue: Math.random() * cfg.nebulaHueRange + cfg.nebulaHueMin,
            alpha: Math.random() * 0.03 + 0.01,
            drift: Math.random() * 0.1,
            depth: Math.random() * 0.4 + 0.6
        });
    }

    // ── Render loop ──
    function drawFrame(time) {
        if (!running) return;

        smoothX += (mouseX - smoothX) * 0.04;
        smoothY += (mouseY - smoothY) * 0.04;
        const offsetX = (smoothX - 0.5) * 2;
        const offsetY = (smoothY - 0.5) * 2;

        ctx.fillStyle = cfg.bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Nebulae
        nebulae.forEach(n => {
            n.x = n.baseX + n.drift * Math.sin(time * 0.0001) - offsetX * cfg.nebulaStrength * n.depth;
            n.y = n.baseY - offsetY * cfg.nebulaStrength * n.depth;
            const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
            grad.addColorStop(0, `hsla(${n.hue}, 80%, 40%, ${n.alpha})`);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
        });

        // Grid
        if (cfg.gridSize > 0) {
            ctx.strokeStyle = 'rgba(0, 80, 160, 0.04)';
            ctx.lineWidth = 0.5;
            for (let x = 0; x < canvas.width; x += cfg.gridSize) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
            }
            for (let y = 0; y < canvas.height; y += cfg.gridSize) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
            }
        }

        // Stars
        stars.forEach(s => {
            s.x = s.baseX - offsetX * cfg.parallaxStrength * s.depth;
            s.y = s.baseY - offsetY * cfg.parallaxStrength * s.depth;
            s.brightness += s.twinkleSpeed;
            const alpha = 0.3 + 0.7 * Math.abs(Math.sin(s.brightness));
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(180, 220, 255, ${alpha})`;
            ctx.fill();
            if (s.r > 1) {
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(100, 180, 255, ${alpha * 0.1})`;
                ctx.fill();
            }
        });

        animId = requestAnimationFrame(drawFrame);
    }
    animId = requestAnimationFrame(drawFrame);

    // ── Return control handle ──
    return {
        canvas,
        stop() {
            running = false;
            if (animId) cancelAnimationFrame(animId);
            document.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('resize', resize);
        }
    };
}
