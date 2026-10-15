using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SagaTechbox;

public sealed record Credentials(string Server, string User, string Pass)
{
    static string Dir => Environment.GetEnvironmentVariable("SAGA_TECHBOX_DIR") is { Length: > 0 } d ? d : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SagaTechbox");
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
        Directory.CreateDirectory(Dir);
        var raw = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(this));
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) raw = ProtectedData.Protect(raw, null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(FileName, raw);
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) { try { File.SetUnixFileMode(FileName, UnixFileMode.UserRead | UnixFileMode.UserWrite); } catch { } }
    }

    public static void Forget() { try { File.Delete(FileName); } catch { } }
}
