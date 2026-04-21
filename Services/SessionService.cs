using System.Collections.Concurrent;
using Microsoft.Extensions.Hosting;
using VEGA.Interfaces;

namespace VEGA.Services;

public class SessionService : ISessionService
{
    private readonly ConcurrentDictionary<string, string> _sessions; // sessionId -> userName
    private readonly string _persistencePath;

    public SessionService(IHostEnvironment env)
    {
        _persistencePath = Path.Combine(env.ContentRootPath, "data", "sessions.json");
        var loaded = JsonFileStore.Load(_persistencePath, () => new Dictionary<string, string>());
        _sessions = new ConcurrentDictionary<string, string>(loaded);
    }

    public string Login(string userName)
    {
        var sessionId = Guid.NewGuid().ToString("N");
        _sessions[sessionId] = userName;
        Persist();
        return sessionId;
    }

    public bool IsLoggedIn(string sessionId)
    {
        return !string.IsNullOrEmpty(sessionId) && _sessions.ContainsKey(sessionId);
    }

    public string? GetUser(string sessionId)
    {
        if (string.IsNullOrEmpty(sessionId)) return null;
        return _sessions.TryGetValue(sessionId, out var user) ? user : null;
    }

    public void Logout(string sessionId)
    {
        if (!string.IsNullOrEmpty(sessionId) && _sessions.TryRemove(sessionId, out _))
            Persist();
    }

    private void Persist()
    {
        JsonFileStore.Save(_persistencePath, new Dictionary<string, string>(_sessions));
    }
}
