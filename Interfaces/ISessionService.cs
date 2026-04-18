namespace VEGA.Interfaces;

public interface ISessionService
{
    string Login(string userName);
    bool IsLoggedIn(string sessionId);
    string? GetUser(string sessionId);
    void Logout(string sessionId);
}
