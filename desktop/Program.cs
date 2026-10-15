using Avalonia;
using Avalonia.Headless;

namespace SagaTechbox;

static class Program
{
    public static string? SnapshotPath, StartPage;

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
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() => SnapshotPath != null
        ? AppBuilder.Configure<App>().UseSkia().UseHeadless(new Avalonia.Headless.AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false }) // a picture of the window without a screen (testing)
        : AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}
