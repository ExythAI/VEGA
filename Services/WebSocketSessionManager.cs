using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using VEGA.Interfaces;

namespace VEGA.Services;

public class WebSocketSessionManager : IWebSocketSessionManager
{
    private readonly ConcurrentDictionary<string, WebSocket> _sockets = new();
    private readonly IWindowManager _windowManager;

    /// <summary>
    /// Registry of inbound message handlers, keyed by message Type string.
    /// Extenders can add handlers via RegisterHandler().
    /// </summary>
    private readonly Dictionary<string, Func<WebSocket, JsonElement?, Task>> _handlers = new();

    public WebSocketSessionManager(IWindowManager windowManager)
    {
        _windowManager = windowManager;

        // Register built-in handlers
        RegisterHandler("hello", HandleHelloAsync);
        RegisterHandler("windowMoved", HandleWindowMovedAsync);
    }

    // ═══════════════════════════════════════════════════════════
    // Handler Registry
    // ═══════════════════════════════════════════════════════════

    /// <summary>
    /// Register a handler for a specific inbound message type.
    /// </summary>
    public void RegisterHandler(string messageType, Func<WebSocket, JsonElement?, Task> handler)
    {
        _handlers[messageType] = handler;
    }

    // ═══════════════════════════════════════════════════════════
    // Connection Lifecycle
    // ═══════════════════════════════════════════════════════════

    public async Task HandleConnectionAsync(WebSocket socket)
    {
        string connectionId = Guid.NewGuid().ToString();
        _sockets.TryAdd(connectionId, socket);

        var buffer = new byte[1024 * 4];
        WebSocketReceiveResult result;

        try
        {
            // Initial broadcast
            await BroadcastWindowStateAsync();

            do
            {
                result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    string message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    await TryHandleMessageAsync(socket, message);
                }

            } while (!result.CloseStatus.HasValue);
        }
        catch (WebSocketException)
        {
            // Connection dropped ungracefully
        }
        finally
        {
            if (_sockets.TryRemove(connectionId, out _))
            {
                if (socket.State == WebSocketState.Open)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closed", CancellationToken.None);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // Inbound Message Dispatch
    // ═══════════════════════════════════════════════════════════

    private async Task TryHandleMessageAsync(WebSocket socket, string messageStr)
    {
        try
        {
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            var envelope = JsonSerializer.Deserialize<WsInboundEnvelope>(messageStr, options);
            if (envelope?.Type == null) return;

            // Resolve the payload — prefer nested Payload, fall back to flat legacy fields
            JsonElement? payload = envelope.Payload;

            // If no nested Payload was sent, wrap the entire message as the payload
            // so legacy flat-format messages still work
            if (payload == null || payload.Value.ValueKind == JsonValueKind.Undefined)
            {
                payload = JsonSerializer.Deserialize<JsonElement>(messageStr, options);
            }

            if (_handlers.TryGetValue(envelope.Type, out var handler))
            {
                await handler(socket, payload);
            }
            else
            {
                Console.WriteLine($"Unknown WS message type: {envelope.Type} (v{envelope.Version})");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error parsing WS message: {ex.Message}");
        }
    }

    // ═══════════════════════════════════════════════════════════
    // Built-in Handlers
    // ═══════════════════════════════════════════════════════════

    private async Task HandleHelloAsync(WebSocket socket, JsonElement? payload)
    {
        var processIds = payload?.TryGetProperty("ProcessIds", out var pidsEl) == true
            ? JsonSerializer.Deserialize<List<string>>(pidsEl.GetRawText())
            : null;

        await RestoreSessionAsync(socket, processIds ?? new List<string>());
    }

    private async Task HandleWindowMovedAsync(WebSocket socket, JsonElement? payload)
    {
        if (payload == null) return;

        var processId = payload.Value.TryGetProperty("ProcessId", out var pidEl) ? pidEl.GetString() : null;
        var x = payload.Value.TryGetProperty("X", out var xEl) ? xEl.GetInt32() : 0;
        var y = payload.Value.TryGetProperty("Y", out var yEl) ? yEl.GetInt32() : 0;
        var width = payload.Value.TryGetProperty("Width", out var wEl) ? wEl.GetInt32() : 0;
        var height = payload.Value.TryGetProperty("Height", out var hEl) ? hEl.GetInt32() : 0;
        var zIndex = payload.Value.TryGetProperty("ZIndex", out var zEl) ? zEl.GetInt32() : 0;

        if (processId != null)
        {
            _windowManager.UpdateWindowState(processId, x, y, width, height, zIndex);
            await BroadcastWindowStateAsync();
        }
    }

    // ═══════════════════════════════════════════════════════════
    // Outbound Broadcasting (versioned envelope)
    // ═══════════════════════════════════════════════════════════

    public async Task BroadcastWindowStateAsync()
    {
        var windows = _windowManager.GetAllActiveWindows();
        var envelope = new WsOutboundEnvelope
        {
            Type = "state",
            Version = 1,
            Payload = new { Windows = windows }
        };
        await BroadcastMessageAsync(envelope);
    }

    public async Task BroadcastMessageAsync(object message)
    {
        var messageString = JsonSerializer.Serialize(message);
        var bytes = Encoding.UTF8.GetBytes(messageString);

        foreach (var socket in _sockets.Values.Where(s => s.State == WebSocketState.Open))
        {
            try
            {
                await socket.SendAsync(new ArraySegment<byte>(bytes, 0, bytes.Length), WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch
            {
                // Ignore dropped connections for now
            }
        }
    }

    public async Task RestoreSessionAsync(WebSocket socket, List<string> processIds)
    {
        // Re-pairing protocol
        // In a more complex scenario, we'd clear UI windows that the backend no longer knows about.
        // For now, we just broadcast the current true state of the backend to overriding the frontend.
        await BroadcastWindowStateAsync();
    }
}

// ═══════════════════════════════════════════════════════════
// Protocol Message Types
// ═══════════════════════════════════════════════════════════

/// <summary>
/// Versioned envelope for all outbound server → client messages.
/// </summary>
public class WsOutboundEnvelope
{
    public string Type { get; set; } = string.Empty;
    public int Version { get; set; } = 1;
    public object? Payload { get; set; }
}

/// <summary>
/// Inbound client → server message envelope.
/// Supports both the versioned format { Type, Version, Payload: { ... } }
/// and the legacy flat format { Type, ProcessId, X, Y, ... } for backward compatibility.
/// </summary>
public class WsInboundEnvelope
{
    public string? Type { get; set; }
    public int Version { get; set; } = 1;
    public JsonElement? Payload { get; set; }

    // Legacy flat fields — retained for backward compatibility with older clients
    public List<string>? ProcessIds { get; set; }
    public string? ProcessId { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public int ZIndex { get; set; }
}
