using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Layout;
using Avalonia.Media;

namespace SagaTechbox;

/// Small helpers so the screens read like a description of the screen.
static class Ui
{
    public static readonly Color Bg = Color.Parse("#0e1417"), Panel = Color.Parse("#18232a"), Panel2 = Color.Parse("#22313a");
    public static IBrush Brush(string hex) => new SolidColorBrush(Color.Parse(hex));
    public static IBrush Muted => Brush("#98a6ad");
    public static IBrush White => Brushes.White;

    public static string ModeHex(string mode)
    {
        var o = DoorClient.Str(DoorClient.Shared.State["settings"]?["colors"]?[mode]);
        if (o.StartsWith("#") && o.Length == 7) return o;
        return mode == "open" ? "#30d158" : mode == "busy" ? "#ff9f0a" : "#ff453a";
    }
    public static string Accent
    {
        get { var a = DoorClient.Str(DoorClient.Shared.State["settings"]?["accent"]); return a.StartsWith("#") && a.Length == 7 ? a : "#30d158"; }
    }

    public static TextBlock Text(string t, double size = 14, bool bold = false, IBrush? color = null, bool wrap = true) => new()
    { Text = t, FontSize = size, FontWeight = bold ? FontWeight.Bold : FontWeight.Normal, Foreground = color ?? White, TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap };

    public static Border Card(Control child, double pad = 18, string? bg = null) => new()
    { Background = bg != null ? Brush(bg) : new SolidColorBrush(Panel), CornerRadius = new CornerRadius(16), Padding = new Thickness(pad), Child = child };

    public static StackPanel Stack(double spacing = 10, params Control[] kids)
    {
        var s = new StackPanel { Spacing = spacing };
        foreach (var k in kids) if (k != null) s.Children.Add(k);
        return s;
    }

    public static StackPanel Row(double spacing = 10, params Control[] kids)
    {
        var s = new StackPanel { Orientation = Orientation.Horizontal, Spacing = spacing, VerticalAlignment = VerticalAlignment.Center };
        foreach (var k in kids) if (k != null) s.Children.Add(k);
        return s;
    }

    public static WrapPanel Wrap(double spacing = 8, params Control[] kids)
    {
        var w = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var k in kids) { if (k == null) continue; k.Margin = new Thickness(0, 0, spacing, spacing); w.Children.Add(k); }
        return w;
    }

    public static Button Btn(string text, Action click, string? bg = null, string fg = "#ffffff", double size = 14, double padV = 10, double padH = 18, bool bold = true)
    {
        var b = new Button
        {
            Content = new TextBlock { Text = text, FontSize = size, FontWeight = bold ? FontWeight.SemiBold : FontWeight.Normal, Foreground = Brush(fg), TextWrapping = TextWrapping.Wrap },
            Background = Brush(bg ?? "#2b3a43"), Foreground = Brush(fg), Padding = new Thickness(padH, padV), CornerRadius = new CornerRadius(12),
            HorizontalContentAlignment = HorizontalAlignment.Center,
        };
        b.Click += (_, _) => click();
        return b;
    }

    public static TextBox Input(string value, string hint, Action<string> changed, bool password = false)
    {
        var t = new TextBox { Text = value, Watermark = hint, PasswordChar = password ? '•' : '\0', Padding = new Thickness(12, 10), CornerRadius = new CornerRadius(10), FontSize = 14 };
        t.TextChanged += (_, _) => changed(t.Text ?? "");
        return t;
    }

    public static string Hex(string mode) => ModeHex(mode);
    /// "#30d158" + "40" → "#4030d158" (Avalonia writes the transparency first)
    public static string Alpha(string hex, string aa) => "#" + aa + hex.TrimStart('#');
    public static string Duration(TimeSpan t)
    {
        var mins = Math.Max(1, (int)Math.Ceiling(t.TotalMinutes));
        if (mins < 60) return mins == 1 ? "1 minuut" : $"{mins} minuten";
        int h = mins / 60, r = mins % 60;
        return r == 0 ? $"{h} uur" : $"{h} uur en {r} min";
    }
    public static StackPanel Page(params Control?[] kids)
    {
        var s = new StackPanel { Spacing = 18, Margin = new Thickness(28) };
        foreach (var k in kids) if (k != null) s.Children.Add(k);
        return s;
    }
    public static T Also<T>(this T x, Action<T> a) { a(x); return x; }
    public static T W<T>(this T c, double width) where T : Control { c.Width = width; return c; }
    public static Control Center(this Control c) { c.HorizontalAlignment = HorizontalAlignment.Center; c.VerticalAlignment = VerticalAlignment.Center; return c; }

    public static string When(DateTime t)
    {
        var today = DateTime.Today;
        if (t.Date == today) return t.ToString("HH:mm");
        if (t.Date == today.AddDays(1)) return "morgen " + t.ToString("HH:mm");
        return t.ToString("ddd d MMM HH:mm", new System.Globalization.CultureInfo("nl-NL"));
    }

    public static string Ago(DateTime t)
    {
        var s = (int)(DateTime.Now - t).TotalSeconds;
        if (s < 60) return "zojuist";
        if (s < 3600) return $"{s / 60} min geleden";
        if (s < 86400) return $"{s / 3600} uur geleden";
        return When(t);
    }
}
