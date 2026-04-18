using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using VEGA.Interfaces;
using VEGA.Models;

namespace VEGA.Services;

public class WindowManager : IWindowManager
{
    private readonly ConcurrentDictionary<string, WindowModel> _windows = new();
    
    // Virtual screen size for placement simulation
    private const int ScreenWidth = 1920;
    private const int ScreenHeight = 1080;

    public WindowModel CreateWindow(WindowType type, string content, int width = 400, int height = 300)
    {
        var (x, y) = CalculateFreeSpace(width, height);
        
        WindowModel newWindow = type switch
        {
            WindowType.Text => new TextWindow(),
            WindowType.Image => new ImageWindow(),
            WindowType.Video => new VideoWindow(),
            WindowType.Html => new HtmlWindow(),
            _ => throw new ArgumentException("Invalid window type")
        };

        newWindow.Content = content;
        newWindow.Width = width;
        newWindow.Height = height;
        newWindow.X = x;
        newWindow.Y = y;
        newWindow.ZIndex = GetTopZIndex() + 1;

        _windows.TryAdd(newWindow.ProcessId, newWindow);
        return newWindow;
    }

    public void CloseWindow(string processId)
    {
        _windows.TryRemove(processId, out _);
    }

    public void UpdateWindowState(string processId, int x, int y, int width, int height, int zIndex)
    {
        if (_windows.TryGetValue(processId, out var window))
        {
            window.X = x;
            window.Y = y;
            if (width > 0) window.Width = width;
            if (height > 0) window.Height = height;
            window.ZIndex = zIndex;
        }
    }

    public IEnumerable<WindowModel> GetAllActiveWindows()
    {
        return _windows.Values.Where(w => w.IsActive).OrderBy(w => w.ZIndex);
    }

    public (int X, int Y) CalculateFreeSpace(int width, int height)
    {
        // Simple placement algorithm
        if (_windows.IsEmpty)
        {
            return (ScreenWidth / 2 - width / 2, ScreenHeight / 2 - height / 2); // Center
        }

        var topWindow = _windows.Values.OrderByDescending(w => w.ZIndex).FirstOrDefault();
        if (topWindow != null)
        {
            int newX = topWindow.X + 40;
            int newY = topWindow.Y + 40;

            if (newX + width > ScreenWidth || newY + height > ScreenHeight)
            {
                return (ScreenWidth / 2 - width / 2, ScreenHeight / 2 - height / 2); // Center if overflow
            }
            return (newX, newY);
        }

        return (0, 0);
    }

    private int GetTopZIndex()
    {
        if (_windows.IsEmpty) return 0;
        return _windows.Values.Max(w => w.ZIndex);
    }
}
