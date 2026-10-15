using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Platform;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;
using Avalonia.Threading;

namespace SagaTechbox;

public sealed class App : Application
{
    MainWindow? _win;
    TrayIcon? _tray;

    public override void Initialize()
    {
        Styles.Add(new FluentTheme());
        RequestedThemeVariant = ThemeVariant.Dark;
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown; // stays in the tray when the window is closed
            _win = new MainWindow();
            desktop.MainWindow = _win;
            _win.Closing += (_, e) => { if (Program.SnapshotPath == null) { e.Cancel = true; _win.Hide(); } };
            SetupTray(desktop);
            DoorClient.Shared.Start();
            if (Program.SnapshotPath != null) _ = Snapshot();
        }
        base.OnFrameworkInitializationCompleted();
    }

    void SetupTray(IClassicDesktopStyleApplicationLifetime desktop)
    {
        try
        {
            var icon = new WindowIcon(AssetLoader.Open(new Uri("avares://SagaTechboxBeheer/Assets/icon.png")));
            _win!.Icon = icon;
            var menu = new NativeMenu();
            NativeMenuItem Item(string t, Action a) { var i = new NativeMenuItem(t); i.Click += (_, _) => a(); return i; }
            menu.Add(Item("Venster openen", ShowWindow));
            menu.Add(new NativeMenuItemSeparator());
            menu.Add(Item("Open", () => Set("open")));
            menu.Add(Item("Gesloten", () => Set("closed")));
            menu.Add(Item("Bezet", () => Set("busy")));
            menu.Add(new NativeMenuItemSeparator());
            menu.Add(Item("Stop", () => { DoorClient.Shared.Stop(); desktop.Shutdown(); }));
            _tray = new TrayIcon { Icon = icon, ToolTipText = "Saga Techbox Deur", Menu = menu };
            _tray.Clicked += (_, _) => ShowWindow();
            DoorClient.Shared.Changed += () => Dispatcher.UIThread.Post(() =>
            {
                var c = DoorClient.Shared;
                _tray.ToolTipText = c.HasState ? $"{c.Name}: {c.Label}{(c.NewCount > 0 ? $" · {c.NewCount} nieuw" : "")}" : "Saga Techbox Deur";
            });
        }
        catch { /* no tray on this desktop: the window still works */ }
    }

    void Set(string mode) => _ = DoorClient.Shared.SetStatusAsync(mode);

    void ShowWindow() { if (_win == null) return; _win.Show(); _win.WindowState = WindowState.Normal; _win.Activate(); }

    // test aid: save a picture of the window and quit (used to check the layout without a screen)
    async Task Snapshot()
    {
        await Task.Delay(6000);
        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            var w = _win!;
            w.Show();
            Avalonia.Threading.Dispatcher.UIThread.RunJobs();
            Avalonia.Headless.HeadlessWindowExtensions.CaptureRenderedFrame(w)?.Save(Program.SnapshotPath!);
        });
        (ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Shutdown();
    }
}
