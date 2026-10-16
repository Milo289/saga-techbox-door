using System.Text.Json;

namespace SagaTechbox;

public sealed class QuickAction
{
    public string Name { get; set; } = "Nieuw";
    public string Mode { get; set; } = "busy";       // open | closed | busy
    public int Minutes { get; set; } = 15;           // 0 = until you change it
    public string Message { get; set; } = "";
}

/// What this app remembers on this computer (not on the server): looks, quick actions, quiet hours.
public sealed class AppSettings
{
    public string Appearance { get; set; } = "system";   // system | light | dark
    public string Accent { get; set; } = "";             // "" = follow the server
    public List<QuickAction> Quick { get; set; } = new()
    {
        new() { Name = "Lunch", Mode = "busy", Minutes = 30, Message = "Even lunch — over een half uur ben ik terug" },
        new() { Name = "Vergadering", Mode = "busy", Minutes = 60, Message = "In vergadering" },
        new() { Name = "Naar huis", Mode = "closed", Minutes = 0, Message = "" },
    };
    public bool QuietOn { get; set; }
    public int QuietFrom { get; set; } = 22 * 60;
    public int QuietTo { get; set; } = 7 * 60;
    // where the window was (so it opens in the same place and size)
    public int WinX { get; set; } = int.MinValue;
    public int WinY { get; set; }
    public int WinW { get; set; }
    public int WinH { get; set; }
    public bool WinMax { get; set; }

    static string FileName => Path.Combine(Credentials.Dir, "settings.json");
    public static AppSettings Current { get; private set; } = Load();

    static AppSettings Load()
    {
        try { if (File.Exists(FileName)) return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FileName)) ?? new(); } catch { }
        return new();
    }

    public void Save()
    {
        try { Directory.CreateDirectory(Credentials.Dir); File.WriteAllText(FileName, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true })); } catch { }
    }

    /// Quiet hours: no sound between the two times.
    public bool Quiet
    {
        get
        {
            if (!QuietOn) return false;
            var m = DateTime.Now.Hour * 60 + DateTime.Now.Minute;
            return QuietFrom <= QuietTo ? m >= QuietFrom && m < QuietTo : m >= QuietFrom || m < QuietTo;
        }
    }
}
