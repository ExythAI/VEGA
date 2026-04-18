using Microsoft.AspNetCore.Mvc;
using VEGA.Interfaces;

namespace VEGA.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly ISessionService _sessionService;

    public AuthController(ISessionService sessionService)
    {
        _sessionService = sessionService;
    }

    [HttpGet("status")]
    public IActionResult GetStatus()
    {
        var sessionId = Request.Cookies["vega_session"];
        var authenticated = _sessionService.IsLoggedIn(sessionId ?? "");
        var userName = authenticated ? _sessionService.GetUser(sessionId!) : null;
        return Ok(new { authenticated, userName });
    }

    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.UserName))
            return BadRequest(new { error = "User name is required." });

        var sessionId = _sessionService.Login(request.UserName.Trim());
        Response.Cookies.Append("vega_session", sessionId, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            MaxAge = TimeSpan.FromDays(7)
        });

        return Ok(new { authenticated = true, userName = request.UserName.Trim() });
    }

    [HttpPost("logout")]
    public IActionResult Logout()
    {
        var sessionId = Request.Cookies["vega_session"];
        if (!string.IsNullOrEmpty(sessionId))
        {
            _sessionService.Logout(sessionId);
            Response.Cookies.Delete("vega_session");
        }
        return Ok(new { authenticated = false });
    }
}

public class LoginRequest
{
    public string? UserName { get; set; }
}
