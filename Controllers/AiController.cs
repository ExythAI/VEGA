using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using VEGA.Auth;
using VEGA.Interfaces;
using VEGA.Models;
using System.Threading.Tasks;

namespace VEGA.Controllers;

[ApiController]
[Route("api/[controller]")]
[VegaSession]
[RequestSizeLimit(256 * 1024)] // 256 KB ceiling per request — windows shouldn't be huge.
public class AiController : ControllerBase
{
    private readonly IWindowManager _windowManager;
    private readonly IWebSocketSessionManager _webSocketSessionManager;

    public AiController(IWindowManager windowManager, IWebSocketSessionManager webSocketSessionManager)
    {
        _windowManager = windowManager;
        _webSocketSessionManager = webSocketSessionManager;
    }

    [HttpPost("windows")]
    public async Task<IActionResult> OpenWindow([FromBody] OpenWindowRequest request)
    {
        WindowModel window;
        try
        {
            window = _windowManager.CreateWindow(request.Type, request.Content, request.Width, request.Height);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }

        // Notify the frontend via WS
        await _webSocketSessionManager.BroadcastWindowStateAsync();

        return Ok(window);
    }

    [HttpDelete("windows/{processId}")]
    public async Task<IActionResult> CloseWindow(string processId)
    {
        _windowManager.CloseWindow(processId);
        
        // Notify the frontend via WS
        await _webSocketSessionManager.BroadcastWindowStateAsync();

        return Ok();
    }

    [HttpGet("windows")]
    public IActionResult GetWindows()
    {
        return Ok(_windowManager.GetAllActiveWindows());
    }
}

public class OpenWindowRequest
{
    public WindowType Type { get; set; }
    public string Content { get; set; } = string.Empty;
    public int Width { get; set; } = 400;
    public int Height { get; set; } = 300;
}
