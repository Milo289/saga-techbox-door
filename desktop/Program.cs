using Avalonia;
using Avalonia.Headless;

namespace SagaTechbox;

static class Program
{
    public static string? SnapshotPath, StartPage;
    /// The developer app: its own name and settings folder, plus an Ontwikkelaar page.
#if DEVELOPER
    public const bool IsDev = true;
#else
    public const bool IsDev = false;
#endif

    [STAThread]
    public static void Main(string[] args)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--snapshot") SnapshotPath = args[i + 1];
            if (args[i] == "--page") StartPage = args[i + 1];
        }
        // test aid: SAGA_TEST_LOGIN="server|user|password" connects a development copy without typing
        if (Environment.GetEnvironmentVariable("SAGA_TEST_LOGIN")?.Split('|') is { Length: 3 } t) new Credentials(DoorClient.Normalize(t[0]), t[1], t[2]).Save();
        // self test for the automatic build: does this app work on this system? (login file, connection, changing the status) — result goes to a file
        var st = Array.IndexOf(args, "--selftest");
        if (st >= 0 && st + 1 < args.Length) { Environment.Exit(SelfTest(args[st + 1]).GetAwaiter().GetResult()); return; }
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    static async Task<int> SelfTest(string resultFile)
    {
        string result; int code;
        try
        {
            var creds = Credentials.Load();
            if (creds == null) throw new Exception("de opgeslagen inlog kon niet worden teruggelezen");
            var c = DoorClient.Shared; c.Start();
            // test aids: answer the questions the connection can ask (SAGA_TEST_CODE = two-step code, SAGA_TEST_TRUST = trust the certificate)
            for (int i = 0; i < 50 && !c.HasState && c.PendingMfa == null && c.PendingTrust == null; i++) await Task.Delay(100);
            if (c.PendingTrust != null && Environment.GetEnvironmentVariable("SAGA_TEST_TRUST") != null) { c.TrustAndRetry(); for (int i = 0; i < 50 && !c.HasState && c.PendingMfa == null; i++) await Task.Delay(100); }
            if (c.PendingMfa != null && Environment.GetEnvironmentVariable("SAGA_TEST_CODE") is { Length: > 0 } totp) await c.SubmitCodeAsync(totp);
            for (int i = 0; i < 150 && !c.HasState; i++) await Task.Delay(100);
            if (!c.HasState) throw new Exception("geen verbinding met de server: " + c.Connection);
            await c.SetStatusAsync("busy", 5);
            if (c.Mode != "busy") throw new Exception("de status veranderde niet");
            await c.PostAsync("/api/status/auto");
            result = $"OK {c.Name} versie={typeof(Program).Assembly.GetName().Version} os={System.Runtime.InteropServices.RuntimeInformation.OSDescription} rechten={c.Perms.Count}";
            code = 0;
        }
        catch (Exception e) { result = "FAIL " + e.Message; code = 1; }
        try { File.WriteAllText(resultFile, result + "\n"); } catch { }
        Console.WriteLine(result);
        return code;
    }

    public static AppBuilder BuildAvaloniaApp() => SnapshotPath != null
        ? AppBuilder.Configure<App>().UseSkia().UseHeadless(new Avalonia.Headless.AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false }) // a picture of the window without a screen (testing)
        : AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}
