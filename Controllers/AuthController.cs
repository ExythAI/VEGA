using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using VEGA.Auth;
using VEGA.Configuration;
using VEGA.Interfaces;

namespace VEGA.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly ISessionService _sessionService;
    private readonly IFaceRecognitionService _faceService;
    private readonly IOptionsMonitor<VegaOptions> _options;

    public AuthController(
        ISessionService sessionService,
        IFaceRecognitionService faceService,
        IOptionsMonitor<VegaOptions> options)
    {
        _sessionService = sessionService;
        _faceService = faceService;
        _options = options;
    }

    [HttpGet("status")]
    public IActionResult GetStatus()
    {
        var sessionId = Request.Cookies[VegaSessionAttribute.CookieName];
        var userName = _sessionService.GetUser(sessionId ?? string.Empty);
        return Ok(new { authenticated = userName != null, userName });
    }

    [HttpPost("login")]
    [EnableRateLimiting("auth")]
    public IActionResult Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.UserName))
            return BadRequest(new { error = "User name is required." });

        var name = request.UserName.Trim();

        // Bootstrap: if no users enrolled at all, allow first login (lets the very first
        // operator establish a session before face enrollment is mandatory).
        // Otherwise, require that the requested name corresponds to an enrolled user —
        // prevents arbitrary identity claims via the manual fallback.
        var enrolledUsers = _faceService.GetEnrolledUsers().ToList();
        if (enrolledUsers.Count > 0 && !_faceService.IsUserEnrolled(name))
        {
            return Unauthorized(new { error = "Unknown operator. Enroll a face for this name first." });
        }

        var sessionId = _sessionService.Login(name);
        Response.Cookies.Append(VegaSessionAttribute.CookieName, sessionId, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            MaxAge = TimeSpan.FromDays(_options.CurrentValue.SessionTtlDays)
        });

        return Ok(new { authenticated = true, userName = name });
    }

    [HttpPost("logout")]
    public IActionResult Logout()
    {
        var sessionId = Request.Cookies[VegaSessionAttribute.CookieName];
        if (!string.IsNullOrEmpty(sessionId))
        {
            _sessionService.Logout(sessionId);
            Response.Cookies.Delete(VegaSessionAttribute.CookieName);
        }
        return Ok(new { authenticated = false });
    }
}

public class LoginRequest
{
    public string? UserName { get; set; }
}
