using System.Collections.Concurrent;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using VEGA.Configuration;
using VEGA.Interfaces;

namespace VEGA.Services;

public class SessionService : ISessionService
{
    private readonly ConcurrentDictionary<string, SessionEntry> _sessions;
    private readonly string _persistencePath;
    private readonly IOptionsMonitor<VegaOptions> _options;

    public SessionService(IHostEnvironment env, IOptionsMonitor<VegaOptions> options)
    {
        _options = options;
        _persistencePath = Path.Combine(env.ContentRootPath, "data", "sessions.json");
        var loaded = JsonFileStore.Load(_persistencePath, () => new Dictionary<string, SessionEntry>());

        // Drop any expired entries on load.
        var now = DateTime.UtcNow;
        var fresh = loaded.Where(kv => kv.Value.ExpiresAt > now);
        _sessions = new ConcurrentDictionary<string, SessionEntry>(fresh);
    }

    public string Login(string userName)
    {
        var sessionId = Guid.NewGuid().ToString("N");
        var ttl = TimeSpan.FromDays(_options.CurrentValue.SessionTtlDays);
        _sessions[sessionId] = new SessionEntry
        {
            UserName = userName,
            ExpiresAt = DateTime.UtcNow.Add(ttl)
        };
        Persist();
        return sessionId;
    }

    public bool IsLoggedIn(string sessionId)
    {
        return GetUser(sessionId) != null;
    }

    public string? GetUser(string sessionId)
    {
        if (string.IsNullOrEmpty(sessionId)) return null;
        if (!_sessions.TryGetValue(sessionId, out var entry)) return null;
        if (entry.ExpiresAt <= DateTime.UtcNow)
        {
            // Lazy cleanup of expired entries on read.
            if (_sessions.TryRemove(sessionId, out _)) Persist();
            return null;
        }
        return entry.UserName;
    }

    public void Logout(string sessionId)
    {
        if (!string.IsNullOrEmpty(sessionId) && _sessions.TryRemove(sessionId, out _))
            Persist();
    }

    private void Persist()
    {
        JsonFileStore.Save(_persistencePath, new Dictionary<string, SessionEntry>(_sessions));
    }
}

public class SessionEntry
{
    public string UserName { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
}
