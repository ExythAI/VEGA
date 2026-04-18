// ═══════════════════════════════════════════════════════════════
// VEGA — Setup Wizard Engine (Composable Step Registry)
// ═══════════════════════════════════════════════════════════════

const SetupWizard = {

  // ── State ──
  steps: [],
  currentStepIndex: -1,
  userName: '',
  webcamStream: null,
  videoEl: null,
  scanCanvasEl: null,
  scanCtx: null,
  scanAnimId: null,
  autoScanTimer: null,
  enrolled: false,
  _starfield: null,

  // ═══════════════════════════════════════════════════════════
  // Step Registry
  // ═══════════════════════════════════════════════════════════

  /**
   * Register a wizard step.
   * @param {object} config
   * @param {string} config.id          - Unique step identifier
   * @param {string} config.label       - Progress bar label (e.g. 'WELCOME')
   * @param {string} config.templateId  - ID of the existing DOM element to show
   * @param {Function} [config.init]    - Called when step becomes active (receives wizard as `this`)
   * @param {Function} [config.cleanup] - Called when leaving this step (receives wizard as `this`)
   */
  registerStep({ id, label, templateId, init, cleanup }) {
    this.steps.push({ id, label, templateId, init, cleanup });
  },

  /**
   * Initialize the wizard: render progress bar, show first step, start starfield.
   */
  init() {
    this._starfield = initStarfield('bg-canvas');
    this.renderProgress();
    this.showStep(0);
  },

  // ═══════════════════════════════════════════════════════════
  // Progress Bar (auto-generated from registered steps)
  // ═══════════════════════════════════════════════════════════

  renderProgress() {
    const container = document.getElementById('wizard-progress');
    if (!container) return;
    container.innerHTML = '';

    this.steps.forEach((step, i) => {
      // Connecting line (before every dot except the first)
      if (i > 0) {
        const line = document.createElement('div');
        line.className = 'progress-line';
        line.id = `prog-line-${i}`;
        container.appendChild(line);
      }

      const stepEl = document.createElement('div');
      stepEl.className = 'progress-step';

      const dot = document.createElement('div');
      dot.className = 'progress-dot';
      dot.id = `prog-dot-${i}`;

      const label = document.createElement('span');
      label.className = 'progress-label';
      label.textContent = step.label;

      dot.appendChild(label);
      stepEl.appendChild(dot);
      container.appendChild(stepEl);
    });
  },

  // ═══════════════════════════════════════════════════════════
  // Step Navigation
  // ═══════════════════════════════════════════════════════════

  /**
   * Show a step by index (number) or by id (string).
   */
  showStep(indexOrId) {
    let index;
    if (typeof indexOrId === 'string') {
      index = this.steps.findIndex(s => s.id === indexOrId);
    } else {
      index = indexOrId;
    }
    if (index < 0 || index >= this.steps.length) return;

    // Cleanup previous step
    const prev = this.currentStepIndex >= 0 ? this.steps[this.currentStepIndex] : null;
    if (prev?.cleanup) prev.cleanup.call(this);

    this.currentStepIndex = index;
    const step = this.steps[index];

    // Hide all wizard-step elements, show current
    document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
    if (step.templateId) {
      const el = document.getElementById(step.templateId);
      if (el) el.classList.add('active');
    }

    // Update progress dots
    this.updateProgress(index);

    // Call step init
    if (step.init) step.init.call(this);
  },

  updateProgress(activeIndex) {
    for (let i = 0; i < this.steps.length; i++) {
      const dot = document.getElementById(`prog-dot-${i}`);
      const line = document.getElementById(`prog-line-${i}`);
      if (!dot) continue;
      dot.classList.remove('active', 'done');
      if (i < activeIndex) dot.classList.add('done');
      else if (i === activeIndex) dot.classList.add('active');
      if (line) {
        line.classList.remove('done');
        if (i < activeIndex) line.classList.add('done');
      }
    }
  },

  /** Advance to the next step. */
  nextStep() {
    if (this.currentStepIndex < this.steps.length - 1) {
      this.showStep(this.currentStepIndex + 1);
    }
  },

  /** Go back to the previous step. */
  prevStep() {
    if (this.currentStepIndex > 0) {
      this.showStep(this.currentStepIndex - 1);
    }
  },

  // ═══════════════════════════════════════════════════════════
  // Shared Utilities (available to all steps via `this`)
  // ═══════════════════════════════════════════════════════════

  // ── Camera initialization ──
  async initCamera(opts = {}) {
    const videoId = opts.videoId || 'wizard-cam-video';
    const canvasId = opts.canvasId || 'wizard-scan-canvas';
    const offlineId = opts.offlineId || 'wizard-cam-offline';
    const resId = opts.resId || 'wizard-cam-res';
    const tsId = opts.tsId || 'wizard-cam-ts';

    try {
      if (!this.webcamStream) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        });
        this.webcamStream = stream;
      }

      this.videoEl = document.getElementById(videoId);
      if (this.videoEl) {
        this.videoEl.srcObject = this.webcamStream;
        this.videoEl.style.display = 'block';
      }

      // Setup scan canvas
      this.scanCanvasEl = document.getElementById(canvasId);
      if (this.scanCanvasEl) {
        this.scanCtx = this.scanCanvasEl.getContext('2d');
        this.startScanAnimation();
      }

      // Hide offline message
      const offline = document.getElementById(offlineId);
      if (offline) offline.style.display = 'none';

      // Update resolution label
      this.videoEl?.addEventListener('loadedmetadata', () => {
        const resLabel = document.getElementById(resId);
        if (resLabel) resLabel.textContent = `${this.videoEl.videoWidth}x${this.videoEl.videoHeight}`;
      });

      // Update timestamp
      if (this.camTimestampInterval) clearInterval(this.camTimestampInterval);
      this.camTimestampInterval = setInterval(() => {
        const tsEl = document.getElementById(tsId);
        if (tsEl) tsEl.textContent = new Date().toISOString().substring(11, 23);
      }, 100);

    } catch (e) {
      console.warn('Camera not available:', e);
      const offline = document.getElementById(offlineId);
      if (offline) offline.style.display = 'flex';
      const video = document.getElementById(videoId);
      if (video) video.style.display = 'none';
    }
  },

  // ── Scan ring animation on canvas ──
  startScanAnimation() {
    if (this.scanAnimId) cancelAnimationFrame(this.scanAnimId);

    const render = () => {
      const canvas = this.scanCanvasEl;
      const ctx = this.scanCtx;
      if (!canvas || !ctx) return;

      const rect = canvas.parentElement.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width)) canvas.width = Math.floor(rect.width);
      if (canvas.height !== Math.floor(rect.height)) canvas.height = Math.floor(rect.height);

      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2, cy = h / 2;
      const radius = Math.min(w, h) * 0.3;
      const t = Date.now() / 1000;

      // Outer ring
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Rotating arc 1
      ctx.beginPath();
      ctx.arc(cx, cy, radius, t * 1.8, t * 1.8 + Math.PI * 0.7);
      ctx.strokeStyle = 'rgba(0, 255, 170, 0.5)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0, 255, 170, 0.4)';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Rotating arc 2
      ctx.beginPath();
      ctx.arc(cx, cy, radius, t * 1.8 + Math.PI, t * 1.8 + Math.PI + Math.PI * 0.7);
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0, 180, 255, 0.4)';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Inner ring
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.65, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 180, 255, 0.12)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Cross lines
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.1)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(cx - radius * 1.2, cy); ctx.lineTo(cx + radius * 1.2, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - radius * 1.2); ctx.lineTo(cx, cy + radius * 1.2); ctx.stroke();

      // Label
      ctx.font = '8px Orbitron';
      ctx.fillStyle = 'rgba(0, 212, 255, 0.25)';
      ctx.textAlign = 'center';
      ctx.fillText('BIOMETRIC SCAN', cx, cy + radius + 16);

      this.scanAnimId = requestAnimationFrame(render);
    };
    render();
  },

  // ── Capture webcam frame as base64 JPEG ──
  captureFrame() {
    if (!this.videoEl || this.videoEl.readyState < 2) return null;
    const c = document.createElement('canvas');
    c.width = this.videoEl.videoWidth;
    c.height = this.videoEl.videoHeight;
    const cx = c.getContext('2d');
    cx.drawImage(this.videoEl, 0, 0);
    return c.toDataURL('image/jpeg', 0.85);
  },

  // ── Stop camera ──
  stopCamera() {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(t => t.stop());
      this.webcamStream = null;
    }
    if (this.scanAnimId) {
      cancelAnimationFrame(this.scanAnimId);
      this.scanAnimId = null;
    }
    if (this.autoScanTimer) {
      clearInterval(this.autoScanTimer);
      this.autoScanTimer = null;
    }
    if (this.camTimestampInterval) {
      clearInterval(this.camTimestampInterval);
      this.camTimestampInterval = null;
    }
  },

  // ── Update status badge ──
  setStatus(step, state, text, subText) {
    const prefix = step === 'register' ? 'reg' : 'verify';
    const badge = document.getElementById(`${prefix}-status`);
    const sub = document.getElementById(`${prefix}-status-sub`);
    if (badge) {
      badge.className = `wizard-status ${state}`;
      badge.textContent = text;
    }
    if (sub) sub.textContent = subText || '';
  },

  // ── Perform login API call ──
  async doLogin(userName) {
    try {
      await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName })
      });

      // Clean up
      this.stopCamera();

      // Redirect after a brief delay for the animation
      setTimeout(() => {
        window.location.href = '/index.html';
      }, 1800);
    } catch (e) {
      console.error('Login failed:', e);
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// Step Definitions
// ═══════════════════════════════════════════════════════════════

SetupWizard.registerStep({
  id: 'welcome',
  label: 'WELCOME',
  templateId: 'wizard-step-welcome',
  init() {
    document.getElementById('btn-begin')?.addEventListener('click', () => this.nextStep());
  }
});

SetupWizard.registerStep({
  id: 'register',
  label: 'REGISTER',
  templateId: 'wizard-step-register',
  init() {
    // Camera
    this.initCamera({
      videoId: 'wizard-cam-video',
      canvasId: 'wizard-scan-canvas',
      offlineId: 'wizard-cam-offline',
      resId: 'wizard-cam-res',
      tsId: 'wizard-cam-ts'
    });

    // Enroll face button
    document.getElementById('btn-enroll-face')?.addEventListener('click', () => this.enrollFace());

    // Skip face button
    document.getElementById('btn-skip-face')?.addEventListener('click', () => {
      const nameInput = document.getElementById('wizard-name-input');
      const name = nameInput?.value.trim();
      if (!name) {
        nameInput?.classList.add('error');
        nameInput?.focus();
        return;
      }
      this.userName = name;
      this.enrolled = false;
      this.showStep('verify');
    });

    // Name input validation
    const nameInput = document.getElementById('wizard-name-input');
    if (nameInput) {
      nameInput.addEventListener('input', () => nameInput.classList.remove('error'));
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.enrollFace();
      });
    }
  },

  // Enroll face — kept here as it's step-specific
  enrollFace: async function() {
    const wiz = SetupWizard;
    const nameInput = document.getElementById('wizard-name-input');
    const name = nameInput?.value.trim();
    if (!name) {
      nameInput?.classList.add('error');
      nameInput?.focus();
      return;
    }

    wiz.userName = name;
    wiz.setStatus('register', 'scanning', 'ENROLLING...', 'CAPTURING BIOMETRIC DATA');

    const imageData = wiz.captureFrame();
    if (!imageData) {
      wiz.setStatus('register', 'error', 'CAPTURE FAILED', 'NO CAMERA FRAME AVAILABLE');
      return;
    }

    try {
      const res = await fetch('/api/face/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image: imageData })
      });
      const data = await res.json();

      if (data.success) {
        wiz.enrolled = true;
        wiz.setStatus('register', 'success', `ENROLLED: ${name.toUpperCase()}`, `BIOMETRIC PROFILE STORED — ${data.totalEnrolled} PROFILE(S)`);
        // Auto-advance after delay
        setTimeout(() => wiz.showStep('verify'), 1500);
      } else {
        wiz.setStatus('register', 'error', 'ENROLLMENT FAILED', data.error || 'UNKNOWN ERROR');
      }
    } catch (e) {
      wiz.setStatus('register', 'error', 'SERVER OFFLINE', 'UNABLE TO REACH BACKEND');
    }
  }
});

SetupWizard.registerStep({
  id: 'verify',
  label: 'VERIFY',
  templateId: 'wizard-step-verify',
  async init() {
    const manualInput = document.getElementById('wizard-manual-input');
    if (manualInput) manualInput.value = this.userName;

    // Check if there are enrolled faces on the server
    let hasEnrolledFaces = this.enrolled;
    if (!hasEnrolledFaces) {
      try {
        const res = await fetch('/api/face/enrolled');
        const enrolled = await res.json();
        hasEnrolledFaces = enrolled && enrolled.length > 0;
      } catch (e) { /* ignore */ }
    }

    if (hasEnrolledFaces) {
      // Start camera for face scanning
      await this.initCamera({
        videoId: 'verify-cam-video',
        canvasId: 'verify-scan-canvas',
        offlineId: 'verify-cam-offline',
        resId: 'verify-cam-res',
        tsId: 'verify-cam-ts'
      });
      if (this.webcamStream) {
        this.setStatus('verify', 'scanning', 'SCANNING...', 'POSITION FACE IN FRAME FOR IDENTIFICATION');
        this.startAutoScan();
      } else {
        this.setStatus('verify', 'idle', 'CAMERA UNAVAILABLE', 'USE MANUAL LOGIN BELOW');
      }
    } else {
      this.setStatus('verify', 'idle', 'MANUAL VERIFICATION', 'ENTER YOUR CALLSIGN TO PROCEED');
    }

    // Bind buttons
    document.getElementById('btn-verify-scan')?.addEventListener('click', () => this.verifyScan());
    document.getElementById('btn-verify-manual')?.addEventListener('click', () => this.manualLogin());
    document.getElementById('btn-retry')?.addEventListener('click', () => this.showStep('register'));

    // Manual input enter key
    if (manualInput) {
      manualInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.manualLogin();
      });
    }
  },

  cleanup() {
    if (this.autoScanTimer) {
      clearInterval(this.autoScanTimer);
      this.autoScanTimer = null;
    }
  },

  // Step-specific methods (accessed via SetupWizard directly)
  startAutoScan: function() {
    const wiz = SetupWizard;
    if (wiz.autoScanTimer) clearInterval(wiz.autoScanTimer);
    wiz.autoScanTimer = setInterval(() => wiz.verifyScan(), 3000);
    setTimeout(() => wiz.verifyScan(), 500);
  },

  verifyScan: async function() {
    const wiz = SetupWizard;
    if (!wiz.webcamStream) return;

    wiz.setStatus('verify', 'scanning', 'SCANNING...', 'ANALYZING BIOMETRIC SIGNATURE');

    const imageData = wiz.captureFrame();
    if (!imageData) {
      wiz.setStatus('verify', 'error', 'CAPTURE FAILED', 'NO CAMERA FRAME AVAILABLE');
      return;
    }

    try {
      const res = await fetch('/api/face/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData })
      });
      const data = await res.json();

      if (data.identity) {
        if (wiz.autoScanTimer) clearInterval(wiz.autoScanTimer);
        wiz.userName = data.identity;
        wiz.setStatus('verify', 'granted', 'ACCESS GRANTED', `IDENTITY VERIFIED: ${data.identity.toUpperCase()} — CONFIDENCE: ${(data.confidence * 100).toFixed(1)}%`);
        await wiz.doLogin(data.identity);
      } else if (data.detected) {
        wiz.setStatus('verify', 'error', 'UNKNOWN IDENTITY', data.message?.toUpperCase() || 'FACE NOT RECOGNIZED');
      } else {
        wiz.setStatus('verify', 'idle', 'NO FACE DETECTED', 'POSITION FACE IN FRAME');
      }
    } catch (e) {
      wiz.setStatus('verify', 'error', 'SERVER OFFLINE', 'UNABLE TO REACH BACKEND');
    }
  },

  manualLogin: async function() {
    const wiz = SetupWizard;
    const manualInput = document.getElementById('wizard-manual-input');
    const name = manualInput?.value.trim();
    if (!name) {
      manualInput?.classList.add('error');
      manualInput?.focus();
      return;
    }

    if (wiz.autoScanTimer) clearInterval(wiz.autoScanTimer);
    wiz.userName = name;
    wiz.setStatus('verify', 'granted', 'ACCESS GRANTED', `OPERATOR: ${name.toUpperCase()}`);
    await wiz.doLogin(name);
  }
});

// ═══════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  // Check if already authenticated
  try {
    const authRes = await fetch('/api/auth/status');
    const auth = await authRes.json();
    if (auth.authenticated) {
      window.location.href = '/index.html';
      return;
    }
  } catch (e) { /* proceed to wizard */ }

  // Check if faces are already enrolled — if so, skip to login step
  let hasEnrolledFaces = false;
  try {
    const enrolledRes = await fetch('/api/face/enrolled');
    const enrolled = await enrolledRes.json();
    hasEnrolledFaces = enrolled && enrolled.length > 0;
  } catch (e) { /* ignore */ }

  // Initialize wizard (renders progress, shows first step, starts starfield)
  SetupWizard.init();

  if (hasEnrolledFaces) {
    // Returning user — skip straight to face login
    SetupWizard.enrolled = true;
    SetupWizard.showStep('verify');
  }
});
