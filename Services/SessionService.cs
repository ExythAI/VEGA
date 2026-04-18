using System.Collections.Concurrent;
using VEGA.Interfaces;

namespace VEGA.Services;

public class SessionService : ISessionService
{
    private readonly ConcurrentDictionary<string, string> _sessions = new(); // sessionId -> userName

    public string Login(string userName)
    {
        var sessionId = Guid.NewGuid().ToString("N");
        _sessions[sessionId] = userName;
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
        if (!string.IsNullOrEmpty(sessionId))
            _sessions.TryRemove(sessionId, out _);
    }
}
