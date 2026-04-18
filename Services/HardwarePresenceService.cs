using VEGA.Interfaces;

namespace VEGA.Services;

public class MockHardwarePresenceService : IHardwarePresenceService
{
    // In a real scenario, this would query the PTZ camera SDK.
    // For now, we return true to indicate the user is present.
    public bool IsUserPresent()
    {
        return true; 
    }
}
