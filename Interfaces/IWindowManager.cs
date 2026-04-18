using System.Collections.Generic;
using VEGA.Models;

namespace VEGA.Interfaces;

public interface IWindowManager
{
    WindowModel CreateWindow(WindowType type, string content, int width = 400, int height = 300);
    void CloseWindow(string processId);
    void UpdateWindowState(string processId, int x, int y, int width, int height, int zIndex);
    IEnumerable<WindowModel> GetAllActiveWindows();
    (int X, int Y) CalculateFreeSpace(int width, int height);
}
