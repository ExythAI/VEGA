using System.Text.Json;

namespace VEGA.Services;

/// <summary>
/// Minimal thread-safe JSON file persistence helper. Writes are atomic via temp-file + rename.
/// Intended for small datasets (sessions, enrollments) where a database is overkill.
/// </summary>
internal static class JsonFileStore
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = false };
    private static readonly object IoLock = new();

    public static T Load<T>(string path, Func<T> defaultFactory)
    {
        lock (IoLock)
        {
            if (!File.Exists(path)) return defaultFactory();
            try
            {
                var json = File.ReadAllText(path);
                if (string.IsNullOrWhiteSpace(json)) return defaultFactory();
                return JsonSerializer.Deserialize<T>(json, Options) ?? defaultFactory();
            }
            catch
            {
                // Corrupt file — start fresh rather than crashing the app.
                return defaultFactory();
            }
        }
    }

    public static void Save<T>(string path, T value)
    {
        lock (IoLock)
        {
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(value, Options));
            // Atomic replace
            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
        }
    }
}
