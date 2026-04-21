namespace VEGA.Configuration;

/// <summary>
/// Strongly-typed configuration bound from the "Vega" section of appsettings.json.
/// </summary>
public class VegaOptions
{
    public const string SectionName = "Vega";

    /// <summary>
    /// Cosine/dot-product similarity threshold for face match. Range typically 0.3–0.6.
    /// Higher = stricter (fewer false positives, more false negatives).
    /// </summary>
    public float FaceMatchThreshold { get; set; } = 0.42f;

    /// <summary>
    /// Server-side session lifetime in days. Cookie MaxAge is set to match.
    /// </summary>
    public int SessionTtlDays { get; set; } = 7;

    /// <summary>
    /// Virtual workspace dimensions used by WindowManager auto-placement.
    /// </summary>
    public int VirtualScreenWidth { get; set; } = 1920;
    public int VirtualScreenHeight { get; set; } = 1080;

    /// <summary>
    /// Whitelist of additional origins permitted to make state-changing (POST/PUT/DELETE) requests.
    /// Same-origin requests are always allowed regardless of this list.
    /// </summary>
    public string[] AllowedOrigins { get; set; } = Array.Empty<string>();

    /// <summary>
    /// Per-IP rate limit for /api/auth/login and /api/face/identify (requests per window).
    /// </summary>
    public int AuthRateLimitPermits { get; set; } = 10;
    public int AuthRateLimitWindowSeconds { get; set; } = 60;

    /// <summary>
    /// Maximum length of incoming base64-encoded image data. Default ~8 MB of base64
    /// (≈ 6 MB raw). Anything larger is rejected before decoding to prevent memory DoS.
    /// </summary>
    public int MaxImageBase64Length { get; set; } = 8 * 1024 * 1024;

    /// <summary>
    /// Hard cap on simultaneous open windows server-side. Prevents unbounded growth
    /// of the WindowManager dictionary.
    /// </summary>
    public int MaxOpenWindows { get; set; } = 50;

    /// <summary>
    /// Maximum size (in characters) of a window's Content payload.
    /// </summary>
    public int MaxWindowContentLength { get; set; } = 64 * 1024;
}
