---

# VEGA Advanced Interface System — Complete Architecture Audit

## 1. System Overview

### Purpose
VEGA is a holographic workspace interface system that combines **biometric authentication** (face recognition) with a **collaborative window management system**. It enables operators to authenticate via their face, then manage and interact with multiple windows in a virtual workspace. The system is designed for desktop environments with real-time synchronization between server and client.

### High-Level Architecture

VEGA follows a **three-tier client-server architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Holographic UI)                │
│  HTML5 + Canvas + CSS3 | Index.html / Setup.html            │
├─────────────────────────────────────────────────────────────┤
│                  Communication Layer                        │
│  HTTP REST API + WebSocket (Real-time Sync)                 │
├─────────────────────────────────────────────────────────────┤
│                 Backend (ASP.NET Core 9.0)                  │
│  Controllers | Services | Middleware | Data Persistence     │
└─────────────────────────────────────────────────────────────┘
```

**Layers:**
- **Presentation Layer**: Frontend (HTML5, CSS3, Vanilla JavaScript)
- **API Layer**: REST Controllers + WebSocket handler
- **Service Layer**: Business logic (sessions, face recognition, window management)
- **Authentication Layer**: Session cookies + attribute-based authorization
- **Security Layer**: CSRF middleware, rate limiting, image validation
- **Data Persistence Layer**: JSON file-based storage (sessions, enrollments)

### Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | .NET / ASP.NET Core | 9.0 |
| Face SDK | FaceAiSharp.Bundle | 0.5.23 |
| Image Processing | SixLabors.ImageSharp | 3.1.12 |
| ML Runtime | Microsoft.ML.OnnxRuntime.DirectML | 1.24.4 |
| Frontend | Vanilla JavaScript, HTML5, CSS3 | ES6+ |
| Fonts | Orbitron, Share Tech Mono, Rajdhani | Google Fonts |
| WebSocket | Native Browser WebSocket API | RFC 6455 |
| Persistence | System.Text.Json + File I/O | Native .NET |

**Frameworks & Middleware:**
- `Microsoft.AspNetCore.RateLimiting` — Fixed-window rate limiting
- `Microsoft.AspNetCore.StaticFiles` — Static asset serving
- Custom middleware: `OriginGuardMiddleware` (CSRF)
- Custom filters: `VegaSessionAttribute` (Authorization)

### Entry Points

**HTTP Endpoints:**
- `GET /setup.html` — Default landing page; setup wizard JS redirects to `/index.html` if authenticated
- `GET /index.html` — Main workspace (requires previous auth)
- `GET /api/auth/status` — Check auth state (public)
- `POST /api/auth/login` — Manual login (rate-limited, public on bootstrap)
- `POST /api/auth/logout` — Logout (requires auth)
- `POST /api/face/enroll` — Enroll face (rate-limited, public on bootstrap)
- `POST /api/face/identify` — Identify face (rate-limited, public on bootstrap)
- `GET /api/face/enrolled` — List enrolled operators (public on bootstrap)
- `DELETE /api/face/enrolled/{name}` — Remove enrolled face (requires auth)
- `POST /api/ai/windows` — Create window (requires auth)
- `DELETE /api/ai/windows/{processId}` — Close window (requires auth)
- `GET /api/ai/windows` — List windows (requires auth)

**WebSocket Endpoint:**
- `WS /ws` — Real-time session; requires valid `vega_session` cookie
  - **Inbound messages**: `hello` (session restore), `windowMoved` (geometry sync)
  - **Outbound messages**: `state` (window list broadcast)

---

## 2. Authentication & Authorization

### First-Time Bootstrap Flow (No Users → First Enrollment)

The system uses a **bootstrap exception** to allow the very first operator to enroll without requiring prior authentication.

**Flow Diagram:**
```
[First load] → setup.html
     ↓
[Check /api/auth/status] → Not authenticated
     ↓
[Check /api/face/enrolled] → Empty (no enrolled faces)
     ↓
[Show WELCOME step]
     ↓
[Register step]
  ├─ Camera init (getUserMedia)
  ├─ [User enters name + captures face via webcam]
  └─ POST /api/face/enroll (name, base64 JPEG)
     ├─ VegaSessionAttribute checks [AllowFirstUser] → Passes (no enrolled users)
     └─ FaceRecognitionService.EnrollFace()
        ├─ Validate name (regex: alphanumeric, _, -, ., 1-50 chars)
        ├─ Decode base64 image
        ├─ Load image, detect faces (must be exactly 1)
        ├─ Align face using landmarks
        ├─ Generate embedding vector
        ├─ Store in ConcurrentDictionary<string, float[]>
        ├─ Persist to data/enrollments.json
        └─ Return success
     ↓
[Show VERIFY step] → Start auto-scan
     ↓
[POST /api/face/identify] — Auto-scan loop every 3s (90s timeout)
     ├─ Capture frame
     ├─ Process image → embedding
     ├─ Compare against all enrolled faces (dot product)
     ├─ If score ≥ threshold (0.42) → Match found
     └─ If match → POST /api/auth/login(name)
        ├─ VegaSessionAttribute → Passes [AllowFirstUser]
        ├─ SessionService.Login()
        │  ├─ Create session ID (GUID)
        │  ├─ Store { UserName, ExpiresAt } in ConcurrentDictionary
        │  ├─ Persist to data/sessions.json
        │  └─ Return sessionId
        ├─ Set cookie: vega_session={sessionId}; HttpOnly; Secure (if HTTPS); SameSite=Strict; MaxAge=7d
        └─ Redirect to /index.html
```

**Bootstrap Security Guarantee:**
- Inside `SessionService.Login()`, the first enrollment is secured via:
  ```csharp
  lock (_faceLock) {  // Atomicity: prevents race condition
      if (!force && _enrolledFaces.ContainsKey(name))
          return error;  // Prevents first-user bypass
  }
  ```

### Returning User Flow (Face Identify → Manual Fallback)

**Flow Diagram:**
```
[Returning user opens /setup.html]
     ↓
[DOMContentLoaded] → fetch /api/auth/status → NOT authenticated
     ↓
[Check /api/face/enrolled] → Non-empty (e.g., ["alice", "bob"])
     ↓
[Skip WELCOME step, Jump to VERIFY step]
     ↓
[Init camera, Start auto-scan]
     ├─ POST /api/face/identify every 3s
     ├─ If match (confidence ≥ 0.42) → Identity found
     │  └─ POST /api/auth/login(identity)
     │     ├─ Check: IsUserEnrolled(name) → True
     │     └─ Create session + set cookie
     │
     └─ If timeout (90s) OR no face detected
        └─ [Show MANUAL AUTHENTICATION section]
           └─ [User enters name manually]
              └─ POST /api/auth/login(manualName)
                 ├─ Check: IsUserEnrolled(manualName) → True or False
                 ├─ If False → Return 401 "Unknown operator"
                 └─ If True → Create session + set cookie
```

**Key Difference from Bootstrap:**
- Returning users CANNOT bypass verification via login-with-unknown-name
- The check `if (enrolledUsers.Count > 0 && !IsUserEnrolled(name)) return 401` blocks unauthenticated logins

### Session Lifecycle: Login → Active → Expiry/Logout

**Session Object Model:**
```csharp
public class SessionEntry {
    public string UserName { get; set; }
    public DateTime ExpiresAt { get; set; }
}
```

**States:**
1. **Created**: On `POST /api/auth/login`
   - SessionId = GUID (e.g., "a1b2c3d4e5f6g7h8i9j0")
   - ExpiresAt = UtcNow + 7 days
   - Stored in memory: `_sessions[sessionId] = entry`
   - Persisted to `data/sessions.json`

2. **Active**: On each `GetUser(sessionId)` check
   - If `entry.ExpiresAt > DateTime.UtcNow` → Return userName
   - Lazy cleanup: if expired, remove and persist

3. **Expired**:
   - Client-side probe: on WebSocket close, fetch `/api/auth/status`
   - If `status.authenticated` is false → Bounce user to setup.html
   - Server-side lazy cleanup: removes expired entries on load

4. **Explicitly Logged Out**: On `POST /api/auth/logout`
   - `_sessions.TryRemove(sessionId)` 
   - Persist updated dictionary

**Cookie Security:**
```csharp
Response.Cookies.Append(VegaSessionAttribute.CookieName, sessionId, new CookieOptions {
    HttpOnly = true,              // Prevents JavaScript XSS access
    Secure = Request.IsHttps,     // Only transmit over HTTPS in production
    SameSite = SameSiteMode.Strict,  // No cross-site requests (strongest CSRF defense)
    Path = "/",                   // Cookie available to entire app
    MaxAge = TimeSpan.FromDays(7) // 7-day expiry
});
```

### Request Authorization Check

All protected endpoints use `[VegaSession]` attribute:
```csharp
public void OnAuthorization(AuthorizationFilterContext context) {
    var sessionId = context.HttpContext.Request.Cookies[CookieName];
    var userName = sessionService.GetUser(sessionId ?? string.Empty);

    if (userName != null) {
        context.HttpContext.Items[UserNameItemKey] = userName;
        context.HttpContext.Items[SessionIdItemKey] = sessionId;
        return;
    }

    // Bootstrap exception: [AllowFirstUser] + no enrolled users → pass
    var allowsFirstUser = context.ActionDescriptor.EndpointMetadata
        .OfType<AllowFirstUserAttribute>().Any();
    if (allowsFirstUser && !faceService.GetEnrolledUsers().Any())
        return;  // Bypass

    context.Result = new UnauthorizedObjectResult(new { error = "Authentication required." });
}
```

---

## 3. Face Recognition System

### Enrollment Flow

**API Endpoint:**
```
POST /api/face/enroll
Headers: Content-Type: application/json
Body: {
  "name": "alice",
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "force": false
}
Response: {
  "success": true,
  "name": "alice",
  "message": "Face enrolled for alice.",
  "totalEnrolled": 1,
  "error": null
}
```

**Step-by-Step Process:**

1. **Input Validation**
   - Name: Regex check `^[a-zA-Z0-9_.-]{1,50}$`
   - If invalid → Return error "Name must be 1-50 chars: letters, numbers, _ . -"

2. **Image Decoding**
   - Extract base64 from data-URI prefix (e.g., strip `data:image/jpeg;base64,`)
   - Check length ≤ `MaxImageBase64Length` (default 8 MB)
   - Decode via `Convert.FromBase64String()`
   - Catch errors → Return "Invalid base64 image"

3. **Atomic Lock** (prevents race enrollments)
   ```csharp
   lock (_faceLock) {
       if (!force && _enrolledFaces.ContainsKey(name))
           return error("Already enrolled. Delete or pass force=true");
   ```

4. **Image Processing** (FaceAiSharp library)
   ```csharp
   using var img = Image.Load<Rgb24>(imageBytes);
   var faces = _faceDetector.DetectFaces(img).ToList();
   
   if (faces.Count == 0) → Error: "No face detected"
   if (faces.Count > 1) → Error: "Multiple faces detected"
   
   var face = faces[0];
   var aligned = img.Clone();
   _faceEmbedder.AlignFaceUsingLandmarks(aligned, face.Landmarks!);
   var embedding = _faceEmbedder.GenerateEmbedding(aligned);  // float[] of ~512-2048 dims
   ```

5. **Storage**
   - In-memory: `_enrolledFaces[name] = embedding`
   - On disk: Call `PersistEnrollments()` → writes to `data/enrollments.json`
   ```json
   {
     "alice": [0.0234, -0.156, 0.821, ...],
     "bob": [0.0421, 0.123, -0.701, ...]
   }
   ```

6. **Response**: Return success with total count

**Error Handling:**
- Image corrupted/unsupported → Wrapped in try/catch, returns "Image could not be processed"
- File I/O failure → Logged but doesn't propagate; in-memory state preserved

### Identification Flow

**API Endpoint:**
```
POST /api/face/identify
Headers: Content-Type: application/json
Body: {
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
Response: {
  "detected": true,
  "identity": "alice",
  "confidence": 0.8234,
  "message": "Identity verified: alice"
}
```

**Step-by-Step:**

1. **Image Decoding** & **Processing** (same as enrollment steps 2-4)

2. **Matching** (dot product similarity)
   ```csharp
   foreach (var (eName, eVec) in _enrolledFaces) {
       var dot = embedding.Dot(eVec);  // Cosine similarity via dot product
       if (dot > bestScore) { bestScore = dot; bestName = eName; }
   }
   
   var isMatch = bestScore >= FaceMatchThreshold (0.42 default);
   ```

3. **Response**:
   - If match: `{ detected: true, identity: "alice", confidence: 0.8234 }`
   - If no match: `{ detected: true, identity: null, message: "Unknown identity" }`
   - If no face: `{ detected: false, message: "No face detected" }`

### Image Processing Pipeline

```
[Base64 string] → Decode
     ↓
[Byte array] → Load via SixLabors.ImageSharp
     ↓
[Rgb24 image] → FaceDetector.DetectFaces()
     ↓
[Face[] with landmarks] → FaceEmbedder.AlignFaceUsingLandmarks()
     ↓
[Aligned image] → FaceEmbedder.GenerateEmbedding()
     ↓
[float[] embedding] (typically 128-512 dimensions)
```

**ONNX Models** (embedded in bundle):
- `scrfd_2.5g_kps.onnx` — Face detection + keypoint (landmark) extraction
- `arcfaceresnet100-11-int8.onnx` — Face embedding generation (ArcFace ResNet-100)
- `open_closed_eye.onnx` — Optional eye state detection

### Configuration

**Default Settings** (from `appsettings.json`):
```json
"Vega": {
  "FaceMatchThreshold": 0.42,
  "MaxImageBase64Length": 8388608  // 8 MB base64 ≈ 6 MB raw
}
```

**Runtime Tuning:**
- `IOptionsMonitor<VegaOptions>` allows live reconfiguration without restart
- Threshold can be increased (e.g., 0.5) for stricter matching (fewer false positives, more false negatives)

### Data Storage

**In-Memory:**
```csharp
ConcurrentDictionary<string, float[]> _enrolledFaces
// Key: operator name (e.g., "alice")
// Value: embedding vector (typically 512 floats = 2 KB each)
```

**On Disk:** `data/enrollments.json`
```json
{
  "alice": [0.0234, -0.156, 0.821, ...],
  "bob": [0.0421, 0.123, -0.701, ...]
}
```

**Atomicity:**
- Writes via `JsonFileStore.Save()` using temp file + atomic rename
- Reads use `JsonFileStore.Load()` with error recovery (returns empty dict on corrupt file)

---

## 4. Window Manager Framework

### Architecture & Design

**Core Model:**
```csharp
public abstract class WindowModel {
    public string ProcessId { get; set; } = Guid.NewGuid().ToString();
    public abstract WindowType Type { get; }
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public int ZIndex { get; set; }
    public bool IsActive { get; set; } = true;
    public string Content { get; set; } = string.Empty;
}

public enum WindowType { Text = 0, Image = 1, Video = 2, Html = 3 }

public sealed class TextWindow : WindowModel { override Type => WindowType.Text; }
public sealed class ImageWindow : WindowModel { override Type => WindowType.Image; }
public sealed class VideoWindow : WindowModel { override Type => WindowType.Video; }
public sealed class HtmlWindow : WindowModel { override Type => WindowType.Html; }
```

**Server-Side State:**
```csharp
private readonly ConcurrentDictionary<string, WindowModel> _windows = new();
```

### Window Types & Lifecycle

| Type | Purpose | Content Format | Renderer |
|------|---------|-----------------|----------|
| **Text** | Plain text display | Plain string | `<p>` with innerText |
| **Image** | Image display | URL or data-URI | `<img src>` |
| **Video** | Video playback | URL (mp4/webm) | `<video autoplay>` |
| **Html** | Rich HTML content | HTML string | Sandboxed `<iframe sandbox>` |

**Window Lifecycle:**

```
[Create] → IWindowManager.CreateWindow()
   ├─ Validate content size ≤ MaxWindowContentLength (64 KB)
   ├─ Check window count < MaxOpenWindows (50)
   ├─ Auto-place at free position via CalculateFreeSpace()
   ├─ Set Z-index = current max + 1
   ├─ Create model: new {Text|Image|Video|Html}Window()
   ├─ Store in _windows ConcurrentDictionary
   └─ Return state
        ↓
[Render] → Front-end receives state
   ├─ Create DOM: <div class="holo-window">
   ├─ Resolve window type (ordinal or TypeName)
   ├─ Look up renderer in registry
   ├─ Call renderer(container, state)
   └─ Apply styles (position, size, z-index)
        ↓
[Move/Resize] → WebSocket windowMoved message
   ├─ UpdateWindowState(processId, x, y, width, height, zIndex)
   └─ Broadcast new state to all clients
        ↓
[Close] → DELETE /api/ai/windows/{processId}
   ├─ _windows.TryRemove(processId, out _)
   └─ Broadcast updated state
```

**Positioning Algorithm:**

```csharp
public (int X, int Y) CalculateFreeSpace(int width, int height) {
    if (_windows.IsEmpty) {
        return (ScreenWidth / 2 - width / 2, ScreenHeight / 2 - height / 2);  // Center
    }

    var topWindow = _windows.Values.OrderByDescending(w => w.ZIndex).FirstOrDefault();
    if (topWindow != null) {
        int newX = topWindow.X + 40;
        int newY = topWindow.Y + 40;

        if (newX + width > ScreenWidth || newY + height > ScreenHeight) {
            return (ScreenWidth / 2 - width / 2, ScreenHeight / 2 - height / 2);  // Recenter if overflow
        }
        return (newX, newY);
    }
    return (0, 0);
}
```

- **First window**: Center of virtual screen
- **Subsequent windows**: Offset 40px down and right from top window
- **Overflow protection**: Recenter if would exceed bounds

### Limits & Constraints

**Server-Side Limits** (from `VegaOptions`):
```json
{
  "MaxOpenWindows": 50,
  "MaxWindowContentLength": 65536,  // 64 KB per window content
  "VirtualScreenWidth": 1920,
  "VirtualScreenHeight": 1080
}
```

**Client-Side Constraints:**
```javascript
this.minWindowWidth = 280;
this.minWindowHeight = 200;
this.gridSize = 20;  // Snap-to-grid size (0 = disabled)
```

**Request Size Limits:**
```csharp
[RequestSizeLimit(256 * 1024)]  // AiController: 256 KB per request
```

### Z-Index Layering

**Layer System:**
```javascript
// Workspace z-index range: 1-99999
// On drag/focus:
const maxZ = Math.max(...windows.zIndex);
element.style.zIndex = maxZ + 1;

// Server broadcasts current z-order to sync across machines
UpdateWindowState(pid, x, y, w, h, zIndex)
```

**Ordering:** `GetAllActiveWindows()` returns windows sorted by Z-index ascending, so renderer can paint bottom-to-top.

---

## 5. Real-Time Communication (WebSocket)

### Connection Flow

**Upgrade:** Client → Server
```javascript
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
```

**Server Accepts:**
```csharp
app.Map("/ws", async context => {
    if (!context.WebSockets.IsWebSocketRequest) { return 400; }

    var sessionId = context.Request.Cookies[VegaSessionAttribute.CookieName];
    var userName = sessionService.GetUser(sessionId ?? string.Empty);

    if (userName == null) { return 401; }  // Must have valid session

    using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
    var wsManager = context.RequestServices.GetRequiredService<IWebSocketSessionManager>();
    await wsManager.HandleConnectionAsync(webSocket);
});
```

**Authentication Flow:**
1. Client opens WS connection
2. Server checks session cookie
3. If invalid → Return 401
4. If valid → Accept and store socket in `ConcurrentDictionary<string, WebSocket>`

### Message Envelope Format

**Outbound (Server → Client):**
```typescript
{
  "Type": "state",
  "Version": 1,
  "Payload": {
    "Windows": [
      {
        "ProcessId": "abc123",
        "Type": 0,  // or "Text" if TypeName is present
        "X": 100,
        "Y": 200,
        "Width": 400,
        "Height": 300,
        "ZIndex": 5,
        "IsActive": true,
        "Content": "..."
      }
    ]
  }
}
```

**Inbound (Client → Server):**

*Legacy Flat Format* (backward compatible):
```json
{
  "Type": "windowMoved",
  "ProcessId": "abc123",
  "X": 150,
  "Y": 220,
  "Width": 420,
  "Height": 320,
  "ZIndex": 6
}
```

*Versioned Envelope Format* (preferred):
```json
{
  "Type": "windowMoved",
  "Version": 1,
  "Payload": {
    "ProcessId": "abc123",
    "X": 150,
    "Y": 220,
    "Width": 420,
    "Height": 320,
    "ZIndex": 6
  }
}
```

### Built-In Handlers

**1. `hello` Message**
- **Purpose**: Client sends on connection; re-pairs frontend with backend
- **Payload**: `{ ProcessIds: ["id1", "id2", ...] }`
- **Server Action**: Calls `RestoreSessionAsync()` → broadcasts full window state
- **Use Case**: Resume after reconnect; client tells server which windows it knows about

**2. `windowMoved` Message**
- **Purpose**: Client sends when user drags/resizes a window
- **Payload**: Geometry update (`ProcessId`, `X`, `Y`, `Width`, `Height`, `ZIndex`)
- **Server Action**: Updates window state in `_windowManager`, broadcasts to all clients

**Threading Model:**
- Handler runs synchronously in message loop
- Geometry updates are non-blocking (no locks)
- Broadcast happens asynchronously to all connected sockets

### Session Association

**One-to-Many Mapping:**
- Each authenticated session cookie can have **multiple WebSocket connections** (e.g., browser tabs/windows)
- All sockets receive **broadcast window state** (not per-session scoped)

```csharp
// Example state:
_sockets = {
  "conn-id-001": WebSocket(...),  // User A session 1
  "conn-id-002": WebSocket(...),  // User B session 1
  "conn-id-003": WebSocket(...)   // User A session 2
}

// On BroadcastWindowStateAsync():
// → All three sockets receive same window list (regardless of which user created each window)
```

### Broadcasting Mechanism

**Implementation:**
```csharp
public async Task BroadcastWindowStateAsync() {
    var windows = _windowManager.GetAllActiveWindows();
    var envelope = new WsOutboundEnvelope {
        Type = "state",
        Version = 1,
        Payload = new { Windows = windows }
    };
    await BroadcastMessageAsync(envelope);
}

public async Task BroadcastMessageAsync(object message) {
    var messageString = JsonSerializer.Serialize(message);
    var bytes = Encoding.UTF8.GetBytes(messageString);

    foreach (var socket in _sockets.Values.Where(s => s.State == WebSocketState.Open)) {
        try {
            await socket.SendAsync(
                new ArraySegment<byte>(bytes, 0, bytes.Length),
                WebSocketMessageType.Text,
                true,
                CancellationToken.None
            );
        } catch {
            // Silently drop failed sends (consumer will detect close)
        }
    }
}
```

- **Scope**: ALL authenticated users see ALL windows (see Limitation #9)
- **Timing**: Sent immediately after state change (create, delete, move, resize)
- **Order**: Oldest → newest connections

### Error Handling & Reconnection

**Connection Drop Detection:**
```javascript
this.ws.onclose = async () => {
    // Probe session status
    try {
        const res = await fetch('/api/auth/status', { cache: 'no-store' });
        const auth = await res.json();
        if (!auth.authenticated) {
            console.warn('Session expired — redirecting to setup.');
            window.location.href = '/setup.html';
            return;
        }
    } catch (_) { /* network down — attempt reconnect */ }

    // Exponential backoff reconnection
    this._reconnectAttempts = (this._reconnectAttempts ?? 0) + 1;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 60000);
    console.warn(`Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}).`);
    setTimeout(() => this.connectWebSocket(), delay);
};
```

**Backoff Strategy:**
- Attempt 1: 1s delay
- Attempt 2: 2s delay
- Attempt 3: 4s delay
- ...
- Attempt 10+: 60s (capped)

**Session Probe:**
- On close, fetch `/api/auth/status` to check if session still valid
- If not → Bounce to setup.html (user logged out elsewhere)
- If yes → Attempt reconnect

---

## 6. Frontend Architecture

### HTML Structure

**Two Entry Points:**

1. **[setup.html](setup.html)** — Setup Wizard (first-time + login)
   - Wizard container with multi-step UI
   - Progress indicator
   - Step templates: Welcome, Register, Verify
   - Camera viewports with HUD overlays
   - Status badges and buttons

2. **[index.html](index.html)** — Workspace (authenticated users)
   - Top bar: Logo, system status, operator name, logoff button
   - Bottom bar: Status indicators
   - Workspace container: windows rendered here
   - Starfield canvas background

### Setup Wizard

**Architecture:** Composable step registry pattern

```javascript
SetupWizard = {
    steps: [],
    currentStepIndex: -1,

    registerStep(config) {
        // config: { id, label, templateId, init, cleanup, ...methods }
        // Methods are hoisted onto SetupWizard for access via this
    },

    showStep(indexOrId) {
        // Hide all, show current, call init()
    }
};
```

**Registered Steps:**

| Step | ID | Label | Behavior |
|------|----|----|----------|
| Welcome | `welcome` | WELCOME | Intro text + BEGIN button |
| Register | `register` | REGISTER | Camera init, manual name input, Enroll Face button, Skip Face button |
| Verify | `verify` | VERIFY | Auto-scan for 90s with face comparison, Manual login fallback |

**State Management:**
```javascript
SetupWizard.userName = '';           // Operator name (set during register/verify)
SetupWizard.webcamStream = null;     // MediaStream from getUserMedia
SetupWizard.videoEl = null;          // <video> element
SetupWizard.scanCanvasEl = null;     // <canvas> for scan ring animation
SetupWizard.enrolled = false;        // Did we enroll this session?
SetupWizard.autoScanTimer = null;    // setInterval handle
SetupWizard.autoScanTimeoutId = null; // Timeout after 90s
```

### Wizard Flow: User Enrollment + Login

```
boot () {
    → Check /api/auth/status
    → If authenticated → Redirect /index.html
    → Else: Check /api/face/enrolled
        → If empty → Show step 0 (Welcome)
        → If not empty → Show step 2 (Verify) — returning user
}

On "BEGIN SETUP" → showStep(1) [Register]
    → initCamera()
        → navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
        → srcObject = stream
        → startScanAnimation() — spinning rings on <canvas>
    → On "ENROLL FACE" click
        → captureFrame() → base64 JPEG
        → POST /api/face/enroll { name, image }
        → If success: show "CONTINUE →" button
                      → showStep(2) [Verify]
        → If error: show error message

showStep(2) [Verify]
    → If hasEnrolledFaces:
        → initCamera()
        → startAutoScan() interval every 3s
            → captureFrame()
            → POST /api/face/identify
            → If identity → POST /api/auth/login(identity)
               → Set cookie → Redirect /index.html
            → If unknown → Show "Unknown identity" message
        → Timeout after 90s → Disable auto-scan, show manual login option
    → Else: Show manual login only

Manual login input:
    → captureFrame() optional (but input can be used alone)
    → POST /api/auth/login { userName }
    → If enrolled: Create session → Redirect
    → Else: "Unknown operator" error
```

### Workspace UI: Window Management

**DOM Structure:**
```html
<body>
  <canvas id="bg-canvas"></canvas>  <!-- Starfield -->
  <div class="scanlines"></div>     <!-- Overlay -->
  <div class="vignette"></div>      <!-- Overlay -->
  <div class="top-bar">...</div>   <!-- Status bar -->
  <div class="bottom-bar">...</div> <!-- Footer -->
  <div class="workspace" id="workspace">  <!-- Windows rendered here -->
    <div class="holo-window" id="win-abc123">
      <div class="window-header">
        <svg class="window-icon">...</svg>
        <span class="window-title">TEXT UI</span>
        <div class="window-controls">
          <div class="window-btn minimize"></div>
          <div class="window-btn close"></div>
        </div>
      </div>
      <div class="window-body"><!-- Content --></div>
      <div class="resize-handle" data-dir="n"></div>
      <div class="resize-handle" data-dir="se"></div>
      ...
    </div>
  </div>
</body>
```

### Renderer System

**Registry Pattern:**
```javascript
windowManager.registerRenderer('text', (container, state) => {
    const p = document.createElement('p');
    p.innerText = state.Content;
    container.appendChild(p);
});

windowManager.registerRenderer('html', (container, state) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', '');  // Prevents script execution, XSS
    iframe.srcdoc = state.Content;
    container.appendChild(iframe);
});
```

**Built-In Renderers:**
- **Text**: `<p>` with plain text (no markdown)
- **Image**: `<img>` with src
- **Video**: `<video autoplay loop muted>` with src
- **HTML**: Sandboxed `<iframe sandbox>` with srcdoc (no external resource access, no scripts)

**Extensibility:**
```javascript
windowManager.registerRenderer('custom-chart', (container, state) => {
    // User can add custom renderers at runtime
});
```

### Content Rendering & Sandboxing

**HTML Windows (XSS Prevention):**
```html
<iframe 
  sandbox=""
  srcdoc="<div>Content here</div>"
></iframe>
```

**Sandbox Effect:**
- No script execution
- No form submission
- No external resource loading
- No access to parent window DOM
- No cookie/localStorage access
- Isolated CSS namespace

This completely neutralizes XSS payload in HTML content.

### Asset Cleanup

**Camera Release on Page Unload:**
```javascript
window.addEventListener('beforeunload', () => {
    SetupWizard.stopCamera();  // Releases MediaStream tracks
});

// stopCamera() implementation
if (this.webcamStream) {
    this.webcamStream.getTracks().forEach(t => t.stop());
    this.webcamStream = null;
}
```

**Prevents:**
- Hanging camera access
- Resource leaks
- Locked hardware

### Error Handling & Status Messages

**User-Facing States:**

| State | Color | Message | Example |
|--------|-------|---------|---------|
| **scanning** | Blue | "SCANNING..." | "ANALYZING BIOMETRIC SIGNATURE" |
| **success** | Green | "ENROLLED: ALICE" | "BIOMETRIC PROFILE STORED — 1 PROFILE(S)" |
| **error** | Amber | "ENROLLMENT FAILED" | "NO FACE DETECTED" |
| **idle** | Dim | "AWAITING REGISTRATION" | "ENTER YOUR CALLSIGN AND CAPTURE YOUR FACE" |
| **granted** | Green (bright) | "ACCESS GRANTED" | "IDENTITY VERIFIED: ALICE — SIMILARITY: 0.8234" |

**User-Triggered Actions:**
```javascript
// On enroll button click
if (!name) {
    nameInput.classList.add('error');  // Red border
    nameInput.focus();
    return;
}

// On response
if (data.success) {
    SetupWizard.setStatus('register', 'success', 'ENROLLED: ALICE', '...');
} else {
    SetupWizard.setStatus('register', 'error', 'ENROLLMENT FAILED', data.error);
}
```

---

## 7. Security Architecture (Post-Phase 4)

### Request Size Limits

**Controller-Level Enforcement:**
```csharp
[RequestSizeLimit(12 * 1024 * 1024)]  // FaceController: 12 MB
public class FaceController : ControllerBase { }

[RequestSizeLimit(256 * 1024)]  // AiController: 256 KB
public class AiController : ControllerBase { }
```

- 12 MB for face functions (covers 8 MB base64 + JSON overhead)
- 256 KB for window operations (windows shouldn't have huge content)

**Default Limit:** 30 MB (ASP.NET Core default)

### Image Size Validation

**Pre-Decode Check:**
```csharp
private (byte[]? Bytes, string? Error) TryDecodeImage(string imageBase64) {
    var maxLen = _options.CurrentValue.MaxImageBase64Length;  // 8 MB
    if (imageBase64.Length > maxLen)
        return (null, $"Image too large (>{maxLen / 1024} KB).");

    var base64 = imageBase64.Contains(',') 
        ? imageBase64[(imageBase64.IndexOf(',') + 1)..] 
        : imageBase64;
    try {
        return (Convert.FromBase64String(base64), null);
    } catch {
        return (null, "Invalid base64 image.");
    }
}
```

**Defense:**
- Validates length **before** decoding (prevents memory exhaustion)
- Strips data-URI prefix safely
- Catches malformed base64

### Image Processing Safety

**Try/Catch Wrapper:**
```csharp
try {
    using var img = Image.Load<Rgb24>(imageBytes);
    var faces = _faceDetector.DetectFaces(img).ToList();
    // ... process
    embedding = _faceEmbedder.GenerateEmbedding(aligned);
} catch (Exception ex) {
    _logger.LogWarning(ex, "Failed to process image");
    return new FaceEnrollResult { 
        Success = false, 
        Error = "Image could not be processed (corrupted or unsupported format)." 
    };
}
```

**Handles:**
- Corrupted image files
- Unsupported formats
- ONNX runtime errors
- Memory exhaustion (graceful degradation)

### Window Content Limits

**Configuration:**
```json
"MaxWindowContentLength": 65536  // 64 KB per window
"MaxOpenWindows": 50
```

**Server-Side Check:**
```csharp
var maxContent = opts.MaxWindowContentLength;
if (!string.IsNullOrEmpty(content) && content.Length > maxContent)
    throw new ArgumentException($"Window content exceeds maximum size of {maxContent}", nameof(content));

if (_windows.Count >= opts.MaxOpenWindows)
    throw new InvalidOperationException($"Maximum of {opts.MaxOpenWindows} windows reached.");
```

**Defense:**
- Prevents DoS via unbounded window creation
- Prevents memory exhaustion via huge content payloads

### HTML XSS Prevention

**Vulnerable Pattern (DO NOT USE):**
```javascript
// DANGEROUS: Direct innerHTML
container.innerHTML = state.Content;  // XSS vector
```

**Secure Pattern (IMPLEMENTED):**
```javascript
const iframe = document.createElement('iframe');
iframe.setAttribute('sandbox', '');  // No scripts, no external resources
iframe.srcdoc = state.Content;       // Content loaded, not executed
container.appendChild(iframe);
```

**Sandbox Attributes:**
- No `allow-scripts` → JavaScript not executed
- No `allow-forms` → Forms can't submit
- No `allow-same-origin` → No cookie/storage access
- No `allow-external-links` → External resources blocked
- Content loaded via `srcdoc` (property, not URL) → Further isolation

### CSRF Defense: OriginGuardMiddleware

**Strategy:** Origin + Referer header check with SameSite=Strict cookies

```csharp
public class OriginGuardMiddleware {
    private static readonly HashSet<string> StateChangingMethods = 
        new(StringComparer.OrdinalIgnoreCase) { "POST", "PUT", "DELETE", "PATCH" };

    public async Task InvokeAsync(HttpContext context) {
        if (!StateChangingMethods.Contains(context.Request.Method)) {
            await _next(context);
            return;
        }

        var origin = context.Request.Headers.Origin.FirstOrDefault()
                   ?? context.Request.Headers.Referer.FirstOrDefault();

        if (string.IsNullOrEmpty(origin)) {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { error = "Missing Origin/Referer header." });
            return;
        }

        if (IsSameOrigin(origin, context.Request) || IsAllowed(origin)) {
            await _next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new { error = "Cross-origin request blocked." });
    }

    private static bool IsSameOrigin(string origin, HttpRequest request) {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var originUri)) return false;
        var host = request.Host.Host;
        var port = request.Host.Port ?? (request.Scheme == "https" ? 443 : 80);
        var originPort = originUri.IsDefaultPort
            ? (originUri.Scheme == "https" ? 443 : 80)
            : originUri.Port;

        return string.Equals(originUri.Scheme, request.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(originUri.Host, host, StringComparison.OrdinalIgnoreCase)
            && originPort == port;
    }

    private bool IsAllowed(string origin) {
        var allowed = _options.CurrentValue.AllowedOrigins;
        if (allowed.Length == 0) return false;

        if (!Uri.TryCreate(origin, UriKind.Absolute, out var originUri)) return false;
        var normalized = $"{originUri.Scheme}://{originUri.Authority}";

        return allowed.Any(a => string.Equals(a.TrimEnd('/'), normalized, StringComparison.OrdinalIgnoreCase));
    }
}
```

**Protection Layers:**

1. **Missing header**: Reject (attacker can't set Origin/Referer from cross-origin)
2. **Same-origin check**: Allow if scheme + host + port match
3. **Allowlist check**: Allow if in `AllowedOrigins` config
4. **Combined with SameSite=Strict cookies**: Browser won't send cookie cross-site (double protection)

### Rate Limiting

**Configuration:**
```json
"AuthRateLimitPermits": 10,
"AuthRateLimitWindowSeconds": 60
```

**Implementation:**
```csharp
builder.Services.AddRateLimiter(rateLimiter => {
    rateLimiter.AddPolicy("auth", context => {
        var opts = context.RequestServices
            .GetRequiredService<IOptionsMonitor<VegaOptions>>().CurrentValue;
        var partitionKey = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => 
            new FixedWindowRateLimiterOptions {
                PermitLimit = opts.AuthRateLimitPermits,      // 10 attempts
                Window = TimeSpan.FromSeconds(opts.AuthRateLimitWindowSeconds),  // Per 60 seconds
                QueueLimit = 0,
                AutoReplenishment = true
            });
    });
});
```

**Applied To:**
- `POST /api/auth/login`
- `POST /api/face/identify` (during auto-scan)

**Response on Exceeded:** HTTP 429 Too Many Requests

**Defense:**
- Limits brute-force attempts to guess operator names or do face spoofing
- Per-IP partitioning (attacker needs many IPs to bypass)

### Persistence Error Handling

**Pattern Used:**
```csharp
private void Persist() {
    try {
        JsonFileStore.Save(_persistencePath, new Dictionary<string, SessionEntry>(_sessions));
    } catch (Exception ex) {
        _logger.LogError(ex, "Failed to persist sessions to {Path}", _persistencePath);
        // Does NOT propagate — in-memory state is preserved
    }
}
```

**Guarantees:**
- I/O failures (disk full, permissions) don't crash the app
- In-memory state remains valid → Session continues to work
- Admin can investigate logs and fix I/O issue
- On next successful persist, state is saved

### Cookie Security

**Settings:**
```csharp
Response.Cookies.Append(VegaSessionAttribute.CookieName, sessionId, new CookieOptions {
    HttpOnly = true,              // Prevents JavaScript access (XSS defense)
    Secure = Request.IsHttps,     // Only HTTPS in production (network sniffing defense)
    SameSite = SameSiteMode.Strict,  // Never sent cross-site (CSRF defense)
    Path = "/",                   // Available to entire app
    MaxAge = TimeSpan.FromDays(7) // 7-day expiry
});
```

| Flag | Protects From | How |
|------|---------------|-----|
| `HttpOnly` | XSS | Prevents `document.cookie` access |
| `Secure` | Network sniffing | Only sent over HTTPS |
| `SameSite=Strict` | CSRF | Never sent in cross-site requests |
| `Path=/` | Scope boundary | Cookie available app-wide |
| `MaxAge=7d` | Stale tokens | Automatic expiry |

### Bootstrap Atomicity

**Race Condition Prevented:**
```csharp
// In FaceRecognitionService.EnrollFace
lock (_faceLock) {
    if (!force && _enrolledFaces.ContainsKey(name))
        return error;  // Already enrolled

    // At this point, under lock, we're sure no one else is enrolling the same name
    // ... enrollment logic ...

    _enrolledFaces[name] = embedding;
    PersistEnrollments();
}
```

**In SessionService.Login:**
```csharp
// Check is not under lock, but [AllowFirstUser] checks via GetEnrolledUsers():
public IEnumerable<string> GetEnrolledUsers() {
    return _enrolledFaces.Keys.ToList();  // Atomic snapshot via ConcurrentDictionary
}

// Two concurrent first-user enrollments could both pass the [AllowFirstUser] check
// BUT only one can win the enrollment lock, securing the state
```

---

## 8. Data Persistence

### JSON File Persistence

**Storage Location:**
```
ContentRootPath (e.g., C:\VShare\VEGA)
    ├── data/
    │   ├── sessions.json
    │   └── enrollments.json
    └── ...
```

### File Store Implementation

**Atomic Write Pattern:**
```csharp
public static void Save<T>(string path, T value) {
    lock (IoLock) {  // Global lock ensures only one writer at a time
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(value, Options));
        // Atomic replace: rename temp to target (atomic on NTFS)
        if (File.Exists(path)) File.Replace(tmp, path, null);
        else File.Move(tmp, path);
    }
}

public static T Load<T>(string path, Func<T> defaultFactory) {
    lock (IoLock) {
        if (!File.Exists(path)) return defaultFactory();
        try {
            var json = File.ReadAllText(path);
            if (string.IsNullOrWhiteSpace(json)) return defaultFactory();
            return JsonSerializer.Deserialize<T>(json) ?? defaultFactory();
        } catch {
            // Corrupt file? Start fresh.
            return defaultFactory();
        }
    }
}
```

**Atomicity Guarantee:**
- Temp file written completely first
- Atomic rename ensures no partial writes
- Lock prevents reader-writer race

**Error Recovery:**
- Corrupt JSON → Load defaults (no crash)
- Missing directory → Created on first persist
- Permissions error → Logged, in-memory state preserved

### Session Persistence

**Data Format:**
```json
{
  "session-id-1": {
    "UserName": "alice",
    "ExpiresAt": "2026-04-28T14:30:00Z"
  },
  "session-id-2": {
    "UserName": "bob",
    "ExpiresAt": "2026-04-29T10:15:00Z"
  }
}
```

**Lifecycle:**
1. On app start: `SessionService` loads `data/sessions.json`
2. Expired entries filtered out immediately
3. On `Login()`: New entry added, `Persist()` called
4. On `GetUser()`: Checks expiry, lazy cleanup if expired
5. On `Logout()`: Entry removed, `Persist()` called

### Enrollment Persistence

**Data Format:**
```json
{
  "alice": [0.0234, -0.156, 0.821, ..., 0.0055],    // 512-element float array
  "bob": [0.0421, 0.123, -0.701, ..., 0.0123],
  "charlie": [0.0812, -0.201, 0.556, ..., 0.0889]
}
```

**Size Estimate:**
- Per operator: ~512 floats × 4 bytes = 2 KB
- 100 operators: 200 KB (very manageable)

**Lifecycle:**
1. On app start: `FaceRecognitionService` loads `data/enrollments.json`
2. In-memory cache populated: `ConcurrentDictionary<string, float[]>`
3. On `EnrollFace()`: Entry added, `PersistEnrollments()` called
4. On `RemoveUser()`: Entry removed, `PersistEnrollments()` called

### Expiration Logic

**Session Expiry Check:**
```csharp
public string? GetUser(string sessionId) {
    if (string.IsNullOrEmpty(sessionId)) return null;
    if (!_sessions.TryGetValue(sessionId, out var entry)) return null;
    
    if (entry.ExpiresAt <= DateTime.UtcNow) {
        // Lazy cleanup
        if (_sessions.TryRemove(sessionId, out _)) Persist();
        return null;
    }
    return entry.UserName;
}
```

**On Load:**
```csharp
var now = DateTime.UtcNow;
var fresh = loaded.Where(kv => kv.Value.ExpiresAt > now);
_sessions = new ConcurrentDictionary<string, SessionEntry>(fresh);
```

**Guarantees:**
- Expired sessions never returned
- Cleanup happens during read (lazy)
- Persisted on next op
- No background job needed

---

## 9. Configuration Model (VegaOptions)

### All Configurable Settings

**File:** `appsettings.json` → `Vega` section

```json
{
  "Vega": {
    "FaceMatchThreshold": 0.42,
    "SessionTtlDays": 7,
    "VirtualScreenWidth": 1920,
    "VirtualScreenHeight": 1080,
    "AllowedOrigins": [],
    "AuthRateLimitPermits": 10,
    "AuthRateLimitWindowSeconds": 60,
    "MaxImageBase64Length": 8388608,
    "MaxOpenWindows": 50,
    "MaxWindowContentLength": 65536
  }
}
```

### Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `FaceMatchThreshold` | float | 0.42 | Dot-product similarity threshold for face match (0.0-1.0). Higher = stricter. |
| `SessionTtlDays` | int | 7 | Session lifetime in days (cookie `MaxAge` = this value). |
| `VirtualScreenWidth` | int | 1920 | Virtual workspace width (pixels) for auto-placement algorithm. |
| `VirtualScreenHeight` | int | 1080 | Virtual workspace height (pixels) for auto-placement algorithm. |
| `AllowedOrigins` | string[] | `[]` | Whitelist of additional origins for CSRF middleware. Same-origin always allowed. |
| `AuthRateLimitPermits` | int | 10 | Max requests per window for `/api/auth/login` and `/api/face/identify`. |
| `AuthRateLimitWindowSeconds` | int | 60 | Rate limit window size in seconds (default: 10 requests per 60s). |
| `MaxImageBase64Length` | int | 8388608 | Max base64 image size in bytes (≈8 MB). Checked before decoding. |
| `MaxOpenWindows` | int | 50 | Hard cap on simultaneous open windows. |
| `MaxWindowContentLength` | int | 65536 | Max window content size in characters (64 KB). |

### Binding Location & Usage

**Configuration Model:**
```csharp
namespace VEGA.Configuration;

public class VegaOptions {
    public const string SectionName = "Vega";

    /// <summary>
    /// Cosine/dot-product similarity threshold for face match. Range typically 0.3–0.6.
    /// </summary>
    public float FaceMatchThreshold { get; set; } = 0.42f;

    // ... more properties ...
}
```

**Binding in Program.cs:**
```csharp
builder.Services.Configure<VegaOptions>(builder.Configuration.GetSection(VegaOptions.SectionName));
```

**Injection & Usage:**
```csharp
public class LoginController {
    private readonly IOptionsMonitor<VegaOptions> _options;

    public LoginController(IOptionsMonitor<VegaOptions> options) {
        _options = options;
    }

    public IActionResult Login([FromBody] LoginRequest request) {
        var opts = _options.CurrentValue;  // Always current value (live reload)
        var maxTtl = opts.SessionTtlDays;
    }
}
```

### Runtime Updates (Live Reconfiguration)

**Key Feature:** `IOptionsMonitor<T>` vs. `IOptions<T>`

- **`IOptions<T>`**: Singleton, reads value once at startup
- **`IOptionsMonitor<T>`**: Reads config file on each `.CurrentValue` access

```csharp
// On file change (if hot-reload enabled):
builder.Services.AddRateLimiter(rateLimiter => {
    rateLimiter.AddPolicy("auth", context => {
        var opts = context.RequestServices.GetRequiredService<IOptionsMonitor<VegaOptions>>().CurrentValue;
        // Each call to .CurrentValue checks for config changes
        var limit = opts.AuthRateLimitPermits;  // Could be different from last call
    });
});
```

**Does NOT Require Restart:**
- Edit `appsettings.json`
- Save file
- Next request sees new values

**Note:** Not all services refresh dynamically (e.g., ConcurrentDictionaries are pre-allocated), but rate limiters and validators using `.CurrentValue` will update.

---

## 10. HTTP API Surface

### Complete Endpoint Reference

**BASE URL:** `http://localhost:5014` (development)

#### Authentication Endpoints

**1. Check Auth Status**
```http
GET /api/auth/status
Content-Type: application/json

Response (200):
{
  "authenticated": true,
  "userName": "alice"
}
```
- No auth required
- Used by setup.html to detect redirect

**2. Login**
```http
POST /api/auth/login
Content-Type: application/json
X-Rate-Limit: 10 requests per 60s (per IP)

Request:
{
  "userName": "alice"
}

Response (200):
{
  "authenticated": true,
  "userName": "alice"
}

Errors:
- 400: User name is required / not valid
- 401: Unknown operator (if users already enrolled)
- 429: Rate limit exceeded
```
- Sets `vega_session` cookie on success
- Bootstrap allows unknown name if no users enrolled

**3. Logout**
```http
POST /api/auth/logout
Content-Type: application/json

Response (200):
{
  "authenticated": false
}
```
- Requires valid session
- Deletes `vega_session` cookie

#### Face Recognition Endpoints

**4. Enroll Face**
```http
POST /api/face/enroll
Content-Type: application/json
Content-Length: max 12 MB

Request:
{
  "name": "alice",
  "image": "data:image/jpeg;base64,/9j/4AAQ...",
  "force": false
}

Response (200):
{
  "success": true,
  "name": "alice",
  "message": "Face enrolled for alice.",
  "totalEnrolled": 1,
  "error": null
}

Errors (200):
{
  "success": false,
  "error": "No face detected in image.",
  "name": null,
  "totalEnrolled": 0
}
```
- Requires valid session (or bootstrap override)
- Rate-limited 10 req/60s
- Errors: invalid name format, no face, multiple faces, image corrupted, already enrolled

**5. Identify Face**
```http
POST /api/face/identify
Content-Type: application/json
Content-Length: max 12 MB

Request:
{
  "image": "data:image/jpeg;base64,/9j/4AAQ..."
}

Response (200):
{
  "detected": true,
  "identity": "alice",
  "confidence": 0.8234,
  "message": "Identity verified: alice"
}

If no match:
{
  "detected": true,
  "identity": null,
  "confidence": 0.4121,
  "message": "Unknown identity"
}

If no face:
{
  "detected": false,
  "identity": null,
  "confidence": 0,
  "message": "No face detected."
}
```
- Requires valid session (or bootstrap override)
- Rate-limited 10 req/60s
- Confidence = dot product (cosine similarity)

**6. Get Enrolled Users**
```http
GET /api/face/enrolled
Content-Type: application/json

Response (200):
[
  { "name": "alice" },
  { "name": "bob" },
  { "name": "charlie" }
]
```
- Requires valid session (or bootstrap override)
- Used by setup.js to check if faces enrolled

**7. Remove Enrolled User**
```http
DELETE /api/face/enrolled/{name}
Content-Type: application/json

Response (200):
{
  "success": true,
  "message": "Removed alice."
}

Response (404):
{
  "error": "No enrolled face named 'alice'."
}
```
- Requires valid session
- Deletes enrollment from both memory and disk

#### Window Management Endpoints

**8. Create Window**
```http
POST /api/ai/windows
Content-Type: application/json
Content-Length: max 256 KB
Authorization: session cookie required

Request:
{
  "Type": 0,
  "Content": "Some text here",
  "Width": 400,
  "Height": 300
}

Response (200):
{
  "ProcessId": "abc123def456...",
  "Type": 0,
  "X": 760,
  "Y": 390,
  "Width": 400,
  "Height": 300,
  "ZIndex": 5,
  "IsActive": true,
  "Content": "Some text here"
}

Errors:
- 400: Content too large / Invalid type
- 409: Max windows reached (50)
- 401: Not authenticated
```

**9. Get All Windows**
```http
GET /api/ai/windows
Content-Type: application/json

Response (200):
[
  {
    "ProcessId": "abc123",
    "Type": 0,
    "X": 100,
    "Y": 200,
    "Width": 400,
    "Height": 300,
    "ZIndex": 1,
    "IsActive": true,
    "Content": "..."
  },
  ...
]
```
- Returns all active windows sorted by Z-index

**10. Close Window**
```http
DELETE /api/ai/windows/{processId}
Content-Type: application/json

Response (200): (empty body)
```
- Requires valid session

### HTTP Status Codes Reference

| Code | Endpoint(s) | Reason |
|------|------------|--------|
| **200** | All | Success |
| **400** | All | Validation errors (invalid input) |
| **401** | `/api/face/*`, `/api/ai/*`, `/auth/logout` | Not authenticated or unknown operator |
| **403** | State-changing requests | CSRF check failed (wrong Origin/Referer) |
| **404** | `/api/face/enrolled/{name}` | Name not found |
| **409** | `/api/ai/windows` | Max windows reached |
| **429** | `/api/auth/login`, `/api/face/identify` | Rate limit exceeded |
| **500** | Any | Server error (logged) |

### Request Size Limits

| Endpoint | Limit | Purpose |
|----------|-------|---------|
| `POST /api/face/*` | 12 MB | Base64 image (8 MB) + JSON overhead |
| `POST /api/ai/windows` | 256 KB | Window is rendered UI, not huge data |
| Default | 30 MB | ASP.NET Core default |

---

## 11. Deployment & Runtime

### Minimum Requirements

**Runtime:**
- .NET Runtime 9.0 (or SDK 9.0+)
- Windows (tested on Windows 10+)
- Processor: x86/x64 with ONNX Runtime support
- RAM: 2 GB minimum (embeddings cache ≈ 1 MB × enrolled users)

**Network:**
- Port 5014 (HTTP development) or 7018 (HTTPS development) free
- WebSocket support (RFC 6455)

**Storage:**
- `data/` folder: readable/writable
- Static assets: served from `wwwroot/`

### Configuration Files

**[appsettings.json](appsettings.json)** — Runtime config
```json
{
  "Logging": { "LogLevel": { "Default": "Information" } },
  "AllowedHosts": "*",
  "Vega": { ... }
}
```
- Loaded by `WebApplicationBuilder.Configuration`
- Bound to `VegaOptions` via `Configure<>`

**[launchSettings.json](launchSettings.json)** — IIS/Kestrel launch config
```json
{
  "profiles": {
    "http": {
      "commandName": "Project",
      "applicationUrl": "http://localhost:5014",
      "environmentVariables": { "ASPNETCORE_ENVIRONMENT": "Development" }
    },
    "https": {
      "commandName": "Project",
      "applicationUrl": "https://localhost:7018;http://localhost:5014",
      "environmentVariables": { "ASPNETCORE_ENVIRONMENT": "Development" }
    }
  }
}
```

### Startup Sequence

**Program.cs Order:**

1. **Create builder**
   ```csharp
   var builder = WebApplication.CreateBuilder(args);
   ```

2. **Configure services**
   ```csharp
   builder.Services.Configure<VegaOptions>(...);
   builder.Services.AddRateLimiter(...);
   builder.Services.AddControllers();
   builder.Services.AddSingleton<ISessionService, SessionService>();
   builder.Services.AddSingleton<IFaceRecognitionService, FaceRecognitionService>();
   builder.Services.AddSingleton<IWindowManager, WindowManager>();
   builder.Services.AddSingleton<IWebSocketSessionManager, WebSocketSessionManager>();
   ```

3. **Build app**
   ```csharp
   var app = builder.Build();
   ```

4. **Configure middleware (order matters!)**
   ```csharp
   app.UseWebSockets();                              // Must be early
   app.UseDefaultFiles(defaultFileOptions);         // Setup.html → default
   app.UseStaticFiles();                            // Serve wwwroot/
   app.UseMiddleware<OriginGuardMiddleware>();      // Before routing
   app.UseRouting();
   app.UseRateLimiter();                            // After routing
   app.MapControllers();
   app.Map("/ws", ...);                             // WebSocket endpoint
   ```

5. **Run**
   ```csharp
   app.Run();
   ```

### Static Asset Serving

**Default Files:**
```csharp
var defaultFileOptions = new DefaultFilesOptions();
defaultFileOptions.DefaultFileNames.Clear();
defaultFileOptions.DefaultFileNames.Add("setup.html");
app.UseDefaultFiles(defaultFileOptions);
```

- `GET /` → serves `setup.html`
- `GET /index.html` → serves workspace
- `GET /css/style.css` → serves static CSS
- `GET /js/app.js` → serves static JS

**MIME Types:** Handled by ASP.NET Core's `UseStaticFiles()`

### Data Folder Initialization

**Creation on Demand:**
```csharp
public static void Save<T>(string path, T value) {
    lock (IoLock) {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) 
            Directory.CreateDirectory(dir);  // Creates if not exists
        // ... save logic ...
    }
}
```

- No explicit initialization needed
- Created automatically on first persist

### Development vs. Production

**Development** (`ASPNETCORE_ENVIRONMENT=Development`):
- `launchSettings.json` profile used
- Port 5014 (HTTP)
- Logging: `Information` level
- No HTTPS required
- Static files served with cache headers

**Production** (`ASPNETCORE_ENVIRONMENT=Production`):
- Set `Secure` flag on cookies → requires HTTPS
- Consider stronger rate limits
- Set `AllowedOrigins` to trusted domains only
- Use reverse proxy (nginx, IIS) with TLS termination
- Monitor `data/` folder I/O

**Key Difference:**
```csharp
Secure = Request.IsHttps  // Set based on actual HTTPS
```
- Automatically `true` if request scheme is `https`
- Set to `false` for HTTP (development)

---

## 12. Known Limitations & Future Work

### Known Limitations

**1. Global Window Visibility — No Per-Session Scoping**
- All authenticated users see ALL active windows (whole workspace)
- Design decision: Simplified implementation
- Future: Implement per-user workspace partitioning
  ```csharp
  // Future: Add operator context to window state
  public string OperatorName { get; set; }
  // Filter broadcasts to only send user's windows
  ```

**2. No Persistent Window State**
- Windows are lost on server restart
- State exists only in memory (`ConcurrentDictionary`)
- Design decision: Real-time transient workspace (like interactive apps)
- Future: Add database persistence
  ```csharp
  // Persist to SQLite or PostgreSQL
  private readonly IWindowRepository _windowRepo;
  await _windowRepo.SaveAsync(window);
  ```

**3. Linear Embedding Storage — No Indexing**
- In-memory embeddings dictionary scales linearly (O(n) lookup per identify)
- For 1000+ enrolled users, lookup becomes slow
- Design decision: Acceptable for small deployments
- Future: Use vector database (Qdrant, Weaviate, Milvus)
  ```csharp
  // Use vector similarity search instead of loop
  var results = await _vectorDb.SearchAsync(embedding, topK: 5);
  ```

**4. No Audit Logging**
- No record of who enrolled, when, which operator did what
- Design decision: Compliance not required in current scope
- Future: Add audit trail
  ```csharp
  _auditLog.Log(new AuditEntry {
      Timestamp = DateTime.UtcNow,
      Operator = userName,
      Action = "ENROLL_FACE",
      Target = "alice"
  });
  ```

**5. Single-Machine Only**
- No multi-instance deployment support
- No session replication across machines
- Design decision: Single-server simplicity
- Future: Add centralized session store (Redis)
  ```csharp
  // Redis cluster for distributed sessions
  services.AddStackExchangeRedisCache(...);
  ```

**6. No Face Liveness Detection**
- Can't prevent spoofing (printed photos, replay attacks)
- Design decision: Accept for demo
- Future: Integrate liveness detection SDK
  ```csharp
  var liveness = await _livenessDetector.CheckAsync(imageStream);
  if (!liveness.IsLive) return error("Liveness check failed");
  ```

**7. No Multi-Tenant Support**
- Single operator workspace only (all users in same workspace)
- Design decision: Single-operator system
- Future: Add operator isolation
  ```csharp
  // Each operator gets private workspace
  var windows = _windowManager.GetWindowsForOperator(operatorName);
  ```

**8. No Admin Console**
- No UI to manage operators, reset passwords, view logs
- Design decision: Out of scope (future phase)
- Future: Add admin panel
  ```html
  GET /admin/ (admin-only)
  - Operator management
  - Session monitoring
  - Audit trail viewer
  - Config editor
  ```

**9. No Rate Limiting on Window Creation**
- Could spam server with window creation
- Design decision: Mitigated by `MaxOpenWindows` hard cap
- Future: Per-operator rate limit
  ```csharp
  await _rateLimiter.CheckAsync($"windows:{operatorName}");
  ```

**10. No Image Format Conversion**
- Only JPEG accepted (from webcam capture)
- PNG might work but not guaranteed
- Design decision: Webcam always outputs JPEG
- Future: Auto-convert unsupported formats

### Future Work (Priority Order)

**Phase 5: Session Scoping**
- Per-operator window visibility
- Shared workspace opt-in
- Window ownership tracking

**Phase 6: Persistence & Scaling**
- Database backend for windows
- Redis for distributed sessions
- Load balancing support
- Multi-instance deployment

**Phase 7: Biometric Enhancements**
- Liveness detection (spoof prevention)
- Multi-factor authentication (PIN + face)
- Face re-enrollment prompts (age/style changes)
- Enrollment quality scoring

**Phase 8: Admin & Operations**
- Admin dashboard
- Operator management UI
- Audit trail viewer
- Performance monitoring
- System health checks

**Phase 9: Advanced Features**
- Voice commands + Transcription
- Gesture recognition
- Eye-gaze window control
- Collaboration (multi-operator workspace)
- Window templates library

---

## Summary: Key Takeaways

**VEGA is a biometric-authenticated holographic workspace** that combines:

- **Biometric Auth**: Face recognition via ONNX (ArcFace, SCRFD)
- **Session Management**: Cookie-based with 7-day TTL
- **Window System**: Draggable, resizable, type-aware rendering
- **Real-Time Sync**: WebSocket with state broadcasting
- **Security-First**: CSRF defense, XSS prevention, rate limiting, image validation
- **Lightweight Persistence**: JSON file-based (sessions, enrollments)
- **Bootstrap-Friendly**: First operator can enroll without prior authentication

**Architecture**: Monolithic ASP.NET Core 9.0 backend with vanilla JS frontend

**Scalability Horizon**: Single-machine (~100 operators), expandable to multi-instance with Redis + database

**Current Gaps**: Per-session scoping, persistent windows, audit logging, liveness detection

This audit document provides a **complete technical reference** for developers maintaining, extending, or deploying VEGA.
