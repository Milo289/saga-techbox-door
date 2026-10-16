using System.Diagnostics;
using System.Text;

namespace SagaTechbox;

/// A real notification from the system (Windows toast, Linux desktop notification). Quiet hours are respected. A failure is never an error: the in-app message is always there.
static class Notifier
{
    public static void Show(string title, string body)
    {
        try
        {
            if (AppSettings.Current.Quiet) return;
            if (OperatingSystem.IsLinux()) Linux(title, body);
            else if (OperatingSystem.IsWindows()) Windows(title, body);
        }
        catch { }
    }

    static void Linux(string title, string body)
    {
        var p = new ProcessStartInfo("notify-send") { UseShellExecute = false, CreateNoWindow = true };
        foreach (var a in new[] { "--app-name=Saga Techbox", "--icon=saga-techbox-beheer", "--", title, body }) p.ArgumentList.Add(a);
        Process.Start(p);
    }

    static void Windows(string title, string body)
    {
        string X(string s) => System.Security.SecurityElement.Escape(s).Replace("'", "''");
        var script =
            "$ErrorActionPreference='Stop';" +
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;" +
            "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);" +
            "$n=$t.GetElementsByTagName('text');" +
            $"$n.Item(0).AppendChild($t.CreateTextNode('{X(title)}')) > $null;" +
            $"$n.Item(1).AppendChild($t.CreateTextNode('{X(body)}')) > $null;" +
            "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($t))";
        var enc = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand {enc}") { UseShellExecute = false, CreateNoWindow = true });
    }
}
