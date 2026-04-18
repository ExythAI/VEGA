using System.Collections.Generic;
using System.Net.WebSockets;
using System.Threading.Tasks;

namespace VEGA.Interfaces;

public interface IWebSocketSessionManager
{
    Task HandleConnectionAsync(WebSocket socket);
    Task BroadcastWindowStateAsync();
    Task BroadcastMessageAsync(object message);
    Task RestoreSessionAsync(WebSocket socket, List<string> processIds);
}
