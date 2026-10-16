using System.Net.Http;
using System.Net.Security;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;

namespace SagaTechbox;

/// The password was right, but the account also needs a code from the verification app.
public sealed class NeedCodeException : Exception
{
    public string Mfa { get; }
    public NeedCodeException(string mfa) : base("Er is een code uit je verificatie-app nodig.") { Mfa = mfa; }
}

/// https with the server's own certificate authority, and this app has not been told to trust it yet.
public sealed class UntrustedException : Exception
{
    public string Host { get; }
    public string Fingerprint { get; }
    public UntrustedException(string host, string fingerprint) : base("Het certificaat van de server is nog niet vertrouwd.") { Host = host; Fingerprint = fingerprint; }
}

/// Trust on first use: the first time the user compares the fingerprint with the one in the panel; afterwards only that authority is accepted for that server.
public static class Pinning
{
    static readonly object Gate = new();
    static (string Host, string Fp)? _pending;
    static string FileName => Path.Combine(Credentials.Dir, "pins.json");

    public static Dictionary<string, string> All()
    {
        try { if (File.Exists(FileName)) return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(FileName)) ?? new(); } catch { }
        return new();
    }
    public static void Trust(string host, string fingerprint)
    {
        lock (Gate)
        {
            var all = All(); all[host] = fingerprint;
            try { Directory.CreateDirectory(Credentials.Dir); File.WriteAllText(FileName, JsonSerializer.Serialize(all)); } catch { }
        }
    }
    public static (string Host, string Fp)? TakePending() { lock (Gate) { var p = _pending; _pending = null; return p; } }

    /// "AA:BB:…" like the panel shows it
    public static string Fingerprint(X509Certificate2 c) => BitConverter.ToString(SHA256.HashData(c.RawData)).Replace('-', ':');

    public static bool Validate(HttpRequestMessage req, X509Certificate2? cert, X509Chain? chain, SslPolicyErrors errors)
    {
        if (errors == SslPolicyErrors.None) return true;
        if (cert == null || chain == null) return false;
        var host = req.RequestUri?.Host ?? "";
        var sent = chain.ChainElements.Select(e => e.Certificate).ToList();
        if ((errors & SslPolicyErrors.RemoteCertificateNameMismatch) == 0 && All().TryGetValue(host, out var pin))
        {
            var ca = sent.FirstOrDefault(c => Fingerprint(c) == pin);
            if (ca != null)
            {
                using var own = new X509Chain();
                own.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
                own.ChainPolicy.CustomTrustStore.Add(ca);
                own.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
                if (own.Build(cert)) return true;
            }
        }
        if (sent.Count > 1) lock (Gate) { _pending = (host, Fingerprint(sent[^1])); }
        return false;
    }

    public static HttpClient Client(TimeSpan timeout) => new(new HttpClientHandler { ServerCertificateCustomValidationCallback = Validate }) { Timeout = timeout };
}

/// "Open at login": Windows through the Run key, Linux through an autostart file.
public static class StartAtLogin
{
    const string Name = "SagaTechboxDeur";
    static string ExePath => Environment.ProcessPath ?? "";
    static string DesktopFile => Path.Combine(Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") is { Length: > 0 } x ? x : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config"), "autostart", (Program.IsDev ? "saga-techbox-dev" : "saga-techbox") + ".desktop");

    public static bool Supported => RuntimeInformation.IsOSPlatform(OSPlatform.Windows) || RuntimeInformation.IsOSPlatform(OSPlatform.Linux);

    public static bool IsOn
    {
        get
        {
            try
            {
                if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return WindowsIsOn();
                if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux)) return File.Exists(DesktopFile);
            }
            catch { }
            return false;
        }
    }

    public static void Set(bool on)
    {
        try
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) { WindowsSet(on); return; }
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                if (!on) { File.Delete(DesktopFile); return; }
                Directory.CreateDirectory(Path.GetDirectoryName(DesktopFile)!);
                File.WriteAllText(DesktopFile, $"[Desktop Entry]\nType=Application\nName=Saga Techbox Deur\nExec=\"{ExePath}\"\nX-GNOME-Autostart-enabled=true\n");
            }
        }
        catch { }
    }

    [SupportedOSPlatform("windows")]
    static bool WindowsIsOn() { using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"); return k?.GetValue(Name + (Program.IsDev ? "Dev" : "")) != null; }

    [SupportedOSPlatform("windows")]
    static void WindowsSet(bool on)
    {
        using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
        if (k == null) return;
        var name = Name + (Program.IsDev ? "Dev" : "");
        if (on) k.SetValue(name, "\"" + ExePath + "\""); else k.DeleteValue(name, false);
    }
}

/// A report for the developer (Dev app): versions, connection, the last events. Never contains passwords, keys or session tokens.
public static class Diagnostics
{
    public static string Report()
    {
        var c = DoorClient.Shared;
        var lines = new List<string>
        {
            "Saga Techbox Deur — diagnose", $"Tijd: {DateTime.Now:yyyy-MM-dd HH:mm:ss}",
            $"App: {typeof(Program).Assembly.GetName().Version} {(Program.IsDev ? "(dev)" : "")}", $"Systeem: {RuntimeInformation.OSDescription} {RuntimeInformation.ProcessArchitecture}",
            $"Server: {c.Server}", $"Server-versie: {DoorClient.Str(c.State["server"]?["version"], "—")}", $"Verbinding: {c.Connection} ({c.LatencyMs} ms)",
            $"Rechten: {string.Join(", ", c.Perms)}", $"Https: {(DoorClient.Str(c.State["https"]?["running"], "") == "True" || c.State["https"]?["running"]?.ToString() == "true" ? "aan" : "uit")}",
            $"Beveiligingsscore: {c.State["security"]?["score"]?.ToString() ?? "—"}", $"Vertrouwde certificaten: {Pinning.All().Count}", "", "Laatste gebeurtenissen:",
        };
        lock (c.Log) lines.AddRange(c.Log.Take(100));
        return string.Join("\n", lines);
    }
}
