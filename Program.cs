using System.Net.WebSockets;
using VEGA.Interfaces;
using VEGA.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();

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

app.UseRouting();
app.MapControllers();

// WebSocket Endpoint
app.Map("/ws", async context =>
{
    if (context.WebSockets.IsWebSocketRequest)
    {
        using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
        var wsManager = app.Services.GetRequiredService<IWebSocketSessionManager>();
        await wsManager.HandleConnectionAsync(webSocket);
    }
    else
    {
        context.Response.StatusCode = 400;
    }
});

app.Run();
