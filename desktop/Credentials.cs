using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SagaTechbox;

public sealed record Credentials(string Server, string User, string Pass)
{
    public static string Dir => Environment.GetEnvironmentVariable("SAGA_TECHBOX_DIR") is { Length: > 0 } d ? d : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), Program.IsDev ? "SagaTechboxDev" : "SagaTechbox");
    static string FileName => Path.Combine(Dir, "login.bin");

    /// Windows: encrypted with the Windows account (DPAPI). Linux: a file only this user can read (mode 600).
    public static Credentials? Load()
    {
        try
        {
            if (!File.Exists(FileName)) return null;
            var raw = File.ReadAllBytes(FileName);
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) raw = ProtectedData.Unprotect(raw, null, DataProtectionScope.CurrentUser);
            return JsonSerializer.Deserialize<Credentials>(Encoding.UTF8.GetString(raw));
        }
        catch { return null; }
    }

    public void Save()
    {
        ForgetToken(); // another login: the old session key no longer fits
        Directory.CreateDirectory(Dir);
        var raw = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(this));
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) raw = ProtectedData.Protect(raw, null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(FileName, raw);
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) { try { File.SetUnixFileMode(FileName, UnixFileMode.UserRead | UnixFileMode.UserWrite); } catch { } }
    }

    public static void Forget() { try { File.Delete(FileName); } catch { } ForgetToken(); }

    // the long-lived session key, kept apart from the password: with two-step verification the app must not need the code every time
    static string TokenFile => Path.Combine(Dir, "session.bin");
    public static string? LoadToken()
    {
        try
        {
            if (!File.Exists(TokenFile)) return null;
            var raw = File.ReadAllBytes(TokenFile);
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) raw = ProtectedData.Unprotect(raw, null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(raw);
        }
        catch { return null; }
    }
    public static void SaveToken(string token)
    {
        try
        {
            Directory.CreateDirectory(Dir);
            var raw = Encoding.UTF8.GetBytes(token);
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) raw = ProtectedData.Protect(raw, null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(TokenFile, raw);
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) { try { File.SetUnixFileMode(TokenFile, UnixFileMode.UserRead | UnixFileMode.UserWrite); } catch { } }
        }
        catch { }
    }
    public static void ForgetToken() { try { File.Delete(TokenFile); } catch { } }
}
