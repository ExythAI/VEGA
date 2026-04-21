using Microsoft.Extensions.Options;
using VEGA.Configuration;

namespace VEGA.Auth;

/// <summary>
/// Lightweight CSRF defense: for state-changing requests (POST/PUT/DELETE/PATCH),
/// reject the request unless its Origin or Referer header is same-origin or in the
/// configured AllowedOrigins list.
///
/// Combined with SameSite=Strict cookies, this blocks cross-site request forgery
/// without requiring anti-forgery tokens for the JSON API.
/// </summary>
public class OriginGuardMiddleware
{
    private static readonly HashSet<string> StateChangingMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        "POST", "PUT", "DELETE", "PATCH"
    };

    private readonly RequestDelegate _next;
    private readonly IOptionsMonitor<VegaOptions> _options;

    public OriginGuardMiddleware(RequestDelegate next, IOptionsMonitor<VegaOptions> options)
    {
        _next = next;
        _options = options;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (!StateChangingMethods.Contains(context.Request.Method))
        {
            await _next(context);
            return;
        }

        var origin = context.Request.Headers.Origin.FirstOrDefault()
                     ?? context.Request.Headers.Referer.FirstOrDefault();

        if (string.IsNullOrEmpty(origin))
        {
            // No Origin/Referer at all on a state-changing request — refuse.
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { error = "Missing Origin/Referer header." });
            return;
        }

        if (IsSameOrigin(origin, context.Request) || IsAllowed(origin))
        {
            await _next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new { error = "Cross-origin request blocked." });
    }

    private static bool IsSameOrigin(string origin, HttpRequest request)
    {
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

    private bool IsAllowed(string origin)
    {
        var allowed = _options.CurrentValue.AllowedOrigins;
        if (allowed.Length == 0) return false;

        if (!Uri.TryCreate(origin, UriKind.Absolute, out var originUri)) return false;
        var normalized = $"{originUri.Scheme}://{originUri.Authority}";

        return allowed.Any(a => string.Equals(a.TrimEnd('/'), normalized, StringComparison.OrdinalIgnoreCase));
    }
}
