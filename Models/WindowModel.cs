using System;

namespace VEGA.Models;

public abstract class WindowModel
{
    public string ProcessId { get; set; } = Guid.NewGuid().ToString();
    public abstract WindowType Type { get; }
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public int ZIndex { get; set; }
    public bool IsActive { get; set; } = true;
    public string Content { get; set; } = string.Empty;
}

public class TextWindow : WindowModel
{
    public override WindowType Type => WindowType.Text;
}

public class ImageWindow : WindowModel
{
    public override WindowType Type => WindowType.Image;
}

public class VideoWindow : WindowModel
{
    public override WindowType Type => WindowType.Video;
}

public class HtmlWindow : WindowModel
{
    public override WindowType Type => WindowType.Html;
}
