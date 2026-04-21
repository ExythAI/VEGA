using System.Net.WebSockets;
using System.Threading.RateLimiting;
using VEGA.Auth;
using VEGA.Configuration;
using VEGA.Interfaces;
using VEGA.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);

// Strongly-typed configuration
builder.Services.Configure<VegaOptions>(builder.Configuration.GetSection(VegaOptions.SectionName));

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();

// Rate limiting — guards brute-force attempts on auth/identify endpoints.
builder.Services.AddRateLimiter(rateLimiter =>
{
    rateLimiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    rateLimiter.AddPolicy("auth", context =>
    {
        var opts = context.RequestServices.GetRequiredService<IOptionsMonitor<VegaOptions>>().CurrentValue;
        var partitionKey = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = opts.AuthRateLimitPermits,
            Window = TimeSpan.FromSeconds(opts.AuthRateLimitWindowSeconds),
            QueueLimit = 0,
            AutoReplenishment = true
        });
    });
});

// VEGA Services
builder.Services.AddSingleton<IWindowManager, WindowManager>();
builder.Services.AddSingleton<IWebSocketSessionManager, WebSocketSessionManager>();
builder.Services.AddSingleton<IHardwarePresenceService, MockHardwarePresenceService>();
builder.Services.AddSingleton<IFaceRecognitionService, FaceRecognitionService>();
builder.Services.AddSingleton<ISessionService, SessionService>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    // development only middleware
}

app.UseWebSockets();

// Serve setup.html as default — the wizard JS redirects to index.html if already authenticated
var defaultFileOptions = new DefaultFilesOptions();
defaultFileOptions.DefaultFileNames.Clear();
defaultFileOptions.DefaultFileNames.Add("setup.html");
app.UseDefaultFiles(defaultFileOptions);
app.UseStaticFiles();

// Lightweight CSRF defense — blocks state-changing cross-origin requests.
app.UseMiddleware<OriginGuardMiddleware>();

app.UseRouting();
app.UseRateLimiter();
app.MapControllers();

// WebSocket Endpoint — requires a valid session cookie.
app.Map("/ws", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = 400;
        return;
    }

    var sessionService = context.RequestServices.GetRequiredService<ISessionService>();
    var sessionId = context.Request.Cookies[VegaSessionAttribute.CookieName];
    var userName = sessionService.GetUser(sessionId ?? string.Empty);

    if (userName == null)
    {
        context.Response.StatusCode = 401;
        return;
    }

    using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
    var wsManager = context.RequestServices.GetRequiredService<IWebSocketSessionManager>();
    await wsManager.HandleConnectionAsync(webSocket);
});

app.Run();
