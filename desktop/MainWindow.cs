using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using System.Text.Json.Nodes;

namespace SagaTechbox;

/// The window: a sidebar on the left (pages and connection), the chosen page on the right.
public sealed class MainWindow : Window
{
    readonly DoorClient C = DoorClient.Shared;
    readonly ContentControl _content = new();
    readonly StackPanel _nav = new() { Spacing = 4 };
    readonly TextBlock _conn = new() { FontSize = 12 };
    Border _side = new();
    readonly TextBlock _logo = new() { Text = Program.IsDev ? "Saga Dev" : "Saga Techbox", FontSize = 17, FontWeight = FontWeight.Bold };
    string _query = "", _devPath = "api/status", _devBody = "", _devOut = "", _devMethod = "GET", _devPart = "view";
    readonly Border _banner = new() { IsVisible = false, CornerRadius = new CornerRadius(20), Padding = new Thickness(18, 10), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 22), Background = new SolidColorBrush(Color.Parse("#2b3a43")) };
    string _page = "status";
    string? _selected;
    // drafts survive a redraw (the page redraws when new data arrives)
    string _message = "", _reply = "", _server = "", _user = "", _pass = "", _note = "";
    int _custom = 45;
    List<DoorClient.Found> _found = new();
    string _connectError = "";
    bool _busy;

    public MainWindow()
    {
        Title = Program.IsDev ? "Saga Techbox Deur — Dev" : "Saga Techbox Deur — Beheer";
        Width = 1020; Height = 700; MinWidth = 820; MinHeight = 560;
        Background = Ui.Brush(Ui.BgHex);
        if (Program.StartPage != null) _page = Program.StartPage;
        _server = Credentials.Load()?.Server ?? "";
        Content = BuildFrame();
        C.Changed += () => Dispatcher.UIThread.Post(Redraw);
        ActualThemeVariantChanged += (_, _) => Redraw();
        // warnings for you: the server lost for more than a minute and a half, and warnings the server raises itself
        var watch = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
        watch.Tick += (_, _) => CheckWarnings();
        watch.Start();
        C.Visit += v => Dispatcher.UIThread.Post(() => Toast($"{VisitLabel(v)}: {(DoorClient.Str(v["name"]) is { Length: > 0 } n ? n : "iemand")}"));
        C.Ring += () => Dispatcher.UIThread.Post(() => { Toast("Er is aangebeld"); try { if (!AppSettings.Current.Quiet) Console.Beep(); } catch { } });
        Redraw();
    }

    // ---------- frame ----------
    Control BuildFrame()
    {
        var side = _side; side.Width = 220; side.Padding = new Thickness(14);
        var logo = Ui.Row(10, new Border { Width = 14, Height = 14, CornerRadius = new CornerRadius(7), Background = Ui.Brush(Ui.Accent) }, _logo);
        var grid = new Grid { RowDefinitions = new RowDefinitions("Auto,*,Auto") };
        grid.Children.Add(logo);
        Grid.SetRow(_nav, 1); _nav.Margin = new Thickness(0, 24, 0, 0); grid.Children.Add(_nav);
        Grid.SetRow(_conn, 2); grid.Children.Add(_conn);
        side.Child = grid;

        var body = new Grid();
        body.Children.Add(new ScrollViewer { Content = _content, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled });
        body.Children.Add(_banner);

        var root = new Grid { ColumnDefinitions = new ColumnDefinitions("220,*") };
        root.Children.Add(side); Grid.SetColumn(body, 1); root.Children.Add(body);
        return root;
    }

    void ApplyTheme()
    {
        var a = AppSettings.Current.Appearance;
        RequestedThemeVariant = a == "light" ? ThemeVariant.Light : a == "dark" ? ThemeVariant.Dark : ThemeVariant.Default;
        Ui.Dark = a == "dark" || (a != "light" && ActualThemeVariant != ThemeVariant.Light);
        Background = Ui.Brush(Ui.BgHex); _side.Background = Ui.Brush(Ui.SideHex); _banner.Background = Ui.Brush(Ui.Soft2); _logo.Foreground = Ui.Brush(Ui.FgHex);
    }

    void Redraw()
    {
        ApplyTheme();
        _conn.Text = (C.Live ? "● " : "○ ") + C.Connection + (C.Live && C.LatencyMs > 0 ? $" · {C.LatencyMs} ms" : "");
        _conn.Foreground = Ui.Brush(C.Live ? "#30d158" : "#ff9f0a");
        _nav.Children.Clear();
        bool configured = Credentials.Load() != null;
        if (!configured || _page == "settings" && false) { _content.Content = ConnectPage(); return; }
        foreach (var (id, label) in new[] { ("status", "Status"), ("inbox", "Bezoekers"), ("manage", "Beheer"), ("settings", "Instellingen") }.Concat(Program.IsDev ? new[] { ("dev", "Ontwikkelaar") } : Array.Empty<(string, string)>()))
        {
            bool on = _page == id;
            var text = id == "inbox" && C.NewCount > 0 ? $"{label}  ({C.NewCount})" : label;
            var b = Ui.Btn(text, () => { _page = id; Redraw(); }, on ? Ui.Accent : "#00000000", on ? "#000000" : Ui.FgHex, 15, 11, 14, on);
            b.HorizontalAlignment = HorizontalAlignment.Stretch; b.HorizontalContentAlignment = HorizontalAlignment.Left;
            _nav.Children.Add(b);
        }
        _content.Content = _page switch { "inbox" => InboxPage(), "manage" => ManagePage(), "settings" => SettingsPage(), "dev" => DevPage(), _ => StatusPage() };
    }

    DateTime? _offlineSince; bool _toldOffline, _firstAlerts = true;
    readonly HashSet<string> _seenAlerts = new();
    void CheckWarnings()
    {
        if (C.HasState && !C.Live) { _offlineSince ??= DateTime.Now; if (!_toldOffline && DateTime.Now - _offlineSince > TimeSpan.FromSeconds(90)) { _toldOffline = true; Toast("Geen verbinding met de deurserver"); Beep(); } }
        else { if (_toldOffline && C.Live) Toast("Weer verbonden"); _offlineSince = null; _toldOffline = false; }
        if (C.State["alerts"] is JsonArray alerts)
            foreach (var a in alerts)
            {
                if (a?["resolvedAt"] != null) continue;
                var id = DoorClient.Str(a?["id"]);
                if (_seenAlerts.Add(id) && !_firstAlerts) { Toast("⚠ " + DoorClient.Str(a?["text"])); Beep(); }
            }
        if (C.HasState) _firstAlerts = false;
    }
    void Beep() { try { if (!AppSettings.Current.Quiet) Console.Beep(); } catch { } }

    string VisitLabel(System.Text.Json.Nodes.JsonNode v) => DoorClient.Str(v["type"]) switch { "bell" => "Aangebeld", "appointment" => "Tijd boeken", "message" => "Vraagje", "callback" => "Terugbellen", _ => "Verzoek" };

    CancellationTokenSource? _toastCts;
    void Toast(string text)
    {
        _banner.Child = Ui.Text(text, 14, true); _banner.IsVisible = true;
        _toastCts?.Cancel(); _toastCts = new();
        var ct = _toastCts.Token;
        _ = Task.Delay(3200, ct).ContinueWith(t => { if (!t.IsCanceled) Dispatcher.UIThread.Post(() => _banner.IsVisible = false); });
    }

    async void Run(string ok, Func<Task> work)
    {
        try { await work(); Toast(ok); } catch (Exception e) { Toast(e.Message); }
    }

    // ---------- status ----------
    Control StatusPage()
    {
        var col = Ui.Hex(C.Mode);
        var modeName = C.HasState ? $"{C.Name} is {C.Label.ToLowerInvariant()}" : "Verbinden…";
        var sub = Ui.Stack(2);
        if (C.Until is { } u) sub.Children.Add(Ui.Text($"tot {u:HH:mm} · {Ui.Duration(u - DateTime.Now)} te gaan", 14, false, Ui.Muted));
        if (C.Message != "") sub.Children.Add(Ui.Text(C.Message, 14, false, Ui.Muted));
        var header = Ui.Card(Ui.Row(18,
            new Border { Width = 84, Height = 84, CornerRadius = new CornerRadius(42), Background = Ui.Brush(Ui.Alpha(Ui.Hex(C.Mode), "40")), Child = Ui.Text(C.Mode == "open" ? "🚪" : C.Mode == "busy" ? "⏳" : "🔒", 38).Center() },
            Ui.Stack(4, Ui.Text(modeName, 30, true), sub)), 22, Ui.Alpha(Ui.Hex(C.Mode), "22"));

        var modes = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*,*") };
        int i = 0;
        foreach (var (id, label) in new[] { ("open", "Open"), ("closed", "Gesloten"), ("busy", "Bezet") })
        {
            var mode = id;
            var b = Ui.Btn(C.Mode == id ? "✓  " + label : label, () => Run($"De deur staat op {label}", () => C.SetStatusAsync(mode)), Ui.Hex(id), "#000000", 20, 30);
            b.HorizontalAlignment = HorizontalAlignment.Stretch; b.Margin = new Thickness(i == 0 ? 0 : 7, 0, i == 2 ? 0 : 7, 0); b.IsEnabled = C.Can("status"); b.Opacity = C.Mode == id ? 1 : 0.85;
            Grid.SetColumn(b, i++); modes.Children.Add(b);
        }

        var durations = new List<Control>();
        foreach (var n in new[] { 15, 30, 60, 120 })
        {
            var minutes = n;
            durations.Add(Ui.Btn(n >= 60 ? $"{n / 60} uur" : $"{n} min", () => Run("Bezet gezet", () => C.SetStatusAsync("busy", minutes)), Ui.Soft));
        }
        var custom = new NumericUpDown { Minimum = 5, Maximum = 600, Increment = 5, Value = _custom, Width = 130, FormatString = "0" };
        custom.ValueChanged += (_, e) => _custom = (int)(e.NewValue ?? 45);
        durations.Add(custom);
        durations.Add(Ui.Btn("Bezet voor deze tijd", () => Run("Bezet gezet", () => C.SetStatusAsync("busy", _custom)), Ui.Soft));

        var how = Ui.Card(Ui.Stack(12,
            Ui.Text("Hoe lang?", 16, true),
            Ui.Wrap(8, durations.ToArray()),
            Ui.Wrap(8,
                Ui.Btn("Volg de openingstijden", () => Run("Volgt de openingstijden", () => C.PostAsync("/api/status/auto")), Ui.Soft),
                Ui.Btn("Bezet beëindigen", () => Run("Bezet beëindigd", () => C.PostAsync("/api/busy/end")), Ui.Soft))));

        if (_message == "") _message = DoorClient.Str(C.State["settings"]?["note"]);
        var msgBox = Ui.Input(_message, "bijv. Ik ben zo terug", t => _message = t);
        var msg = Ui.Card(Ui.Stack(10, Ui.Text("Bericht op de deur", 16, true),
            Ui.Row(10, msgBox.W(420), Ui.Btn("Plaatsen", () => Run("Bericht staat op de deur", () => C.PostAsync("/api/settings", new() { ["note"] = _message })), Ui.Accent, "#000000"),
                Ui.Btn("Wissen", () => { _message = ""; Run("Bericht gewist", () => C.PostAsync("/api/settings", new() { ["note"] = "" })); }, Ui.Soft))));

        return Ui.Page(header, Stats(), C.Can("status") ? QuickBar() : null, Ui.Text("Zet de deur op", 17, true), modes, C.Can("status") ? how : null, C.Can("status") ? msg : null);
    }

    // ---------- visitors ----------
    Control InboxPage()
    {
        var all = C.Requests.Where(r => DoorClient.Str(r["state"]) is "new" or "seen").ToList();
        var q = _query.Trim().ToLowerInvariant();
        if (q != "") all = C.Requests.Where(r => (DoorClient.Str(r["name"]) + " " + Summary(r) + " " + DoorClient.Str(r["nr"]) + " " + VisitLabel(r)).ToLowerInvariant().Contains(q)).ToList();
        var left = new StackPanel { Spacing = 6 };
        foreach (var r in all)
        {
            var id = DoorClient.Str(r["id"]);
            var name = DoorClient.Str(r["name"]) is { Length: > 0 } n ? n : "Anoniem";
            var line = $"{VisitLabel(r)}{(Summary(r) is { Length: > 0 } s ? " — " + s : "")}";
            var created = DoorClient.Time(r["createdAt"]) ?? DateTime.Now;
            var b = new Button
            {
                HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 10), CornerRadius = new CornerRadius(12),
                Background = Ui.Brush(_selected == id ? Ui.Soft2 : Ui.PanelHex),
                Content = Ui.Stack(2, Ui.Row(8, Ui.Text(name, 15, true), DoorClient.Str(r["state"]) == "new" ? Ui.Text("NIEUW", 10, true, Ui.Brush(Ui.Accent)) : null!, Ui.Text(Ui.Ago(created), 12, false, Ui.Muted)), Ui.Text(line, 13, false, Ui.Muted)),
            };
            b.Click += (_, _) => { _selected = id; Redraw(); };
            left.Children.Add(b);
        }
        if (all.Count == 0) left.Children.Add(Ui.Card(Ui.Stack(4, Ui.Text("Niemand wacht", 16, true), Ui.Text("Nieuwe bezoekers verschijnen hier meteen.", 13, false, Ui.Muted))));
        var leftPane = new StackPanel { Spacing = 10, Width = 340 };
        leftPane.Children.Add(Ui.Input(_query, "Zoeken in bezoekers", t => { _query = t; }).Also(tb => tb.KeyUp += (_, e) => { if (e.Key == Avalonia.Input.Key.Enter) Redraw(); }));
        leftPane.Children.Add(left);
        leftPane.Children.Add(Ui.Row(8, Ui.Btn("Alles als gezien", () => Run("Gezien", () => C.PostAsync("/api/requests/seen")), Ui.Soft, size: 12, padV: 7),
            Ui.Btn("Afgehandelde wissen", () => Run("Gewist", () => C.PostAsync("/api/requests/clear")), Ui.Soft, size: 12, padV: 7),
            Ui.Btn("Exporteren (CSV)", ExportCsv, Ui.Soft, size: 12, padV: 7)));

        var sel = all.FirstOrDefault(r => DoorClient.Str(r["id"]) == _selected) ?? C.Requests.FirstOrDefault(r => DoorClient.Str(r["id"]) == _selected);
        Control right = sel == null ? Ui.Card(Ui.Text("Kies een bezoeker om te antwoorden.", 15, false, Ui.Muted)) : RequestDetail(sel);
        var g = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), Margin = new Thickness(28) };
        leftPane.Margin = new Thickness(0, 0, 22, 0);
        g.Children.Add(leftPane); Grid.SetColumn(right, 1); g.Children.Add(right);
        return g;
    }

    static string Summary(System.Text.Json.Nodes.JsonNode r)
    {
        var parts = new[] { "topic", "message", "reason" }.Select(k => DoorClient.Str(r[k])).Where(x => x != "").ToList();
        return string.Join(" — ", parts);
    }

    Control RequestDetail(System.Text.Json.Nodes.JsonNode r)
    {
        var id = DoorClient.Str(r["id"]);
        var name = DoorClient.Str(r["name"]) is { Length: > 0 } n ? n : "Anoniem";
        var kids = new List<Control> { Ui.Text(name, 26, true), Ui.Text($"{VisitLabel(r)} · {Ui.Ago(DoorClient.Time(r["createdAt"]) ?? DateTime.Now)}", 14, false, Ui.Muted) };
        if (Summary(r) != "") kids.Add(Ui.Card(Ui.Text(Summary(r), 17), 14, Ui.Soft));
        if (DoorClient.Str(r["phone"]) != "") kids.Add(Ui.Text("📞 Bel terug: " + DoorClient.Str(r["phone"]) + (DoorClient.Str(r["when"]) != "" ? $" ({DoorClient.Str(r["when"])})" : ""), 14));
        if (DoorClient.Str(r["email"]) != "") kids.Add(Ui.Text("✉ " + DoorClient.Str(r["email"]), 14, false, Ui.Muted));
        if (DoorClient.Str(r["reply"]) != "") kids.Add(Ui.Text("↩ " + DoorClient.Str(r["reply"]), 14, false, Ui.Brush(Ui.Accent)));

        void Send(string t) { t = t.Trim(); if (t == "") return; _reply = ""; Run("Getoond op de deur", () => C.PostAsync("/api/requests/reply", new() { ["id"] = id, ["reply"] = t })); }
        var replyBox = Ui.Input(_reply, "Typ een antwoord…", t => _reply = t);
        var quick = C.QuickReplies.Select(q => (Control)Ui.Btn(q, () => Send(q), Ui.Soft, size: 13, padV: 8)).ToArray();
        kids.Add(Ui.Card(Ui.Stack(10, Ui.Text("Antwoord op de deur", 15, true), Ui.Wrap(6, quick), Ui.Row(10, replyBox.W(360), Ui.Btn("Versturen", () => Send(_reply), Ui.Accent, "#000000")))));
        kids.Add(Ui.Row(10,
            Ui.Btn("Afhandelen", () => Run("Afgehandeld", () => C.PostAsync("/api/requests/done", new() { ["id"] = id })), Ui.Soft),
            Ui.Btn("Blokkeer 1 uur", () => Run("Geblokkeerd", () => C.PostAsync("/api/moderation/block", new() { ["id"] = id, ["minutes"] = 60 })), Ui.Soft),
            Ui.Btn("Verwijderen", () => Run("Verwijderd", () => C.PostAsync("/api/requests/delete", new() { ["id"] = id })), Ui.DangerSoft)));
        return Ui.Stack(14, kids.ToArray());
    }

    // ---------- management ----------
    Control ManagePage()
    {
        var parts = new List<Control>();
        var health = C.State["health"] as System.Text.Json.Nodes.JsonArray;
        if (health is { Count: > 0 })
        {
            var rows = new StackPanel { Spacing = 8 };
            foreach (var h in health)
            {
                bool ok = h?["ok"]?.GetValue<bool>() ?? false;
                rows.Children.Add(Ui.Row(10, Ui.Text(ok ? "✓" : "!", 16, true, Ui.Brush(ok ? "#30d158" : "#ff9f0a")), Ui.Stack(0, Ui.Text(DoorClient.Str(h?["text"]), 14), ok ? null! : Ui.Text(DoorClient.Str(h?["tip"]), 12, false, Ui.Muted))));
            }
            parts.Add(Ui.Card(Ui.Stack(10, Ui.Text("Controle", 16, true), rows)));
        }
        var power = C.State["power"];
        if (C.Can("power") && (power?["available"]?.GetValue<bool>() ?? false))
        {
            bool on = power?["enabled"]?.GetValue<bool>() ?? false;
            var kids = new List<Control> { Ui.Text("Energie", 16, true) };
            if (!on) kids.Add(Ui.Text("Energiebeheer staat uit — zet het aan in het webpaneel (Instellingen → Energie).", 13, false, Ui.Muted));
            if (DoorClient.Time(power?["pending"]?["at"]) is { } at) kids.Add(Ui.Row(10, Ui.Text($"Computer gaat uit om {at:HH:mm:ss}", 14, true, Ui.Brush("#ff9f0a")), Ui.Btn("Afbreken", () => Run("Afgebroken", () => C.PostAsync("/api/power/cancel")), "#ff9f0a", "#000000")));
            Control P(string t, string a, string ok, bool confirm = false) => Ui.Btn(t, () => { if (confirm && !Confirm(t)) return; Run(ok, () => C.PostAsync("/api/power/now", new() { ["action"] = a })); }, Ui.Soft);
            var row = Ui.Wrap(8, P("Scherm uit", "screenOff", "Scherm uit"), P("Scherm aan", "screenOn", "Scherm aan"), P("Computer uit…", "computer", "Afteltijd gestart", true), P("Slaapstand…", "hibernate", "Afteltijd gestart", true), P("Herstart…", "restart", "Afteltijd gestart", true));
            row.IsEnabled = on; kids.Add(row);
            parts.Add(Ui.Card(Ui.Stack(10, kids.ToArray())));
        }
        if (C.Can("inbox") && C.State["pendingProfiles"] is System.Text.Json.Nodes.JsonArray pend && pend.Count > 0)
        {
            var rows = new StackPanel { Spacing = 8 };
            foreach (var p in pend)
            {
                var pid = DoorClient.Str(p?["id"]);
                rows.Children.Add(Ui.Row(10, Ui.Stack(0, Ui.Text(DoorClient.Str(p?["name"]), 14, true), Ui.Text(DoorClient.Str(p?["nr"]), 12, false, Ui.Muted)),
                    Ui.Btn("Goedkeuren", () => Run("Goedgekeurd", () => C.PostAsync("/api/moderation/profile", new() { ["id"] = pid, ["approve"] = true })), Ui.Accent, "#000000", 13, 7),
                    Ui.Btn("Afwijzen", () => Run("Afgewezen", () => C.PostAsync("/api/moderation/profile", new() { ["id"] = pid, ["approve"] = false })), Ui.DangerSoft, size: 13, padV: 7)));
            }
            parts.Add(Ui.Card(Ui.Stack(10, Ui.Text("Profielen ter goedkeuring", 16, true), rows)));
        }
        parts.Add(Ui.Card(Ui.Stack(10, Ui.Text("Veiligheid", 16, true), Ui.Wrap(8,
            C.Can("system") ? Ui.Btn("Back-up maken", () => Run("Back-up gemaakt", () => C.PostAsync("/api/system/backups/create")), Ui.Soft) : null!,
            C.Can("system") ? Ui.Btn("Andere sessies beëindigen", () => Run("Andere sessies beëindigd", () => C.PostAsync("/api/system/revoke-all")), Ui.Soft) : null!,
            Ui.Btn("Noodstop", () => { if (Confirm("Noodstop: het bedieningspaneel gaat voor iedereen op slot.")) Run("Noodstop actief", () => C.PostAsync("/api/system/lockdown")); }, "#d32f2f").Also(b => b.IsEnabled = C.Can("system"))))));
        string Info(string path, string d = "—") => DoorClient.Str(C.State["server"]?[path], d);
        parts.Add(Ui.Card(Ui.Stack(8, Ui.Text("Server", 16, true), Ui.Text($"Adres: {C.Server}", 13, false, Ui.Muted), Ui.Text($"Versie: {Info("version")}", 13, false, Ui.Muted),
            Ui.Text($"Jouw rol: {DoorClient.Str(C.State["me"]?["name"])} · {DoorClient.Str(C.State["me"]?["role"])}", 13, false, Ui.Muted))));
        return Ui.Page(parts.ToArray());
    }

    bool Confirm(string text) => true; // the actions have their own countdown on the door screen and can be cancelled; the emergency stop asks in the web panel too

    // ---------- connect / account ----------
    Control ConnectPage()
    {
        var kids = new List<Control> { Ui.Text("Verbinden met de deurserver", 26, true), Ui.Text("Vul het adres van de server in, of laat de app hem zoeken in je netwerk.", 14, false, Ui.Muted) };
        var serverBox = Ui.Input(_server, "bijv. 192.168.1.50:8080", t => _server = t);
        kids.Add(Ui.Row(10, serverBox.W(360), Ui.Btn("Zoeken", async () => { _found = await DoorClient.DiscoverAsync(); if (_found.Count == 1) _server = _found[0].Url; _connectError = _found.Count == 0 ? "Geen server gevonden. Staat hij aan, en op hetzelfde netwerk?" : ""; Redraw(); }, Ui.Soft)));
        foreach (var f in _found) { var url = f.Url; kids.Add(Ui.Btn($"{f.Name}  —  {f.Host}:{f.Port}  ·  versie {f.Version}", () => { _server = url; Redraw(); }, Ui.Soft, bold: false)); }
        kids.Add(Ui.Input(_user, "Gebruikersnaam", t => _user = t).W(360));
        kids.Add(Ui.Input(_pass, "Wachtwoord", t => _pass = t, true).W(360));
        if (_connectError != "") kids.Add(Ui.Text(_connectError, 13, true, Ui.Brush("#ff9f0a")));
        kids.Add(Ui.Row(10, Ui.Btn(_busy ? "Bezig…" : "Verbinden", async () =>
        {
            _busy = true; _connectError = ""; Redraw();
            try
            {
                await C.LoginAsync(_server, _user, _pass);
                new Credentials(DoorClient.Normalize(_server), _user.Trim().ToLowerInvariant(), _pass).Save();
                _pass = ""; _page = "status"; C.Start();
            }
            catch (Exception e) { _connectError = e.Message; }
            _busy = false; Redraw();
        }, Ui.Accent, "#000000"),
            Credentials.Load() != null ? Ui.Btn("Account en server vergeten", () => { C.Stop(); Credentials.Forget(); _page = "status"; Redraw(); }, Ui.DangerSoft) : null!));
        kids.Add(Ui.Text(OperatingSystem.IsWindows() ? "Je inlog wordt versleuteld bewaard met je Windows-account." : "Je inlog wordt bewaard in een bestand dat alleen jouw gebruiker kan lezen.", 12, false, Ui.Muted));
        return Ui.Page(kids.ToArray());
    }

    // ---------- today in numbers, quick actions ----------
    Control Stats()
    {
        var today = C.Requests.Where(r => (DoorClient.Time(r["createdAt"]) ?? DateTime.MinValue).Date == DateTime.Today).ToList();
        var waiting = C.Requests.Count(r => DoorClient.Str(r["state"]) is "new" or "seen");
        var bells = today.Count(r => DoorClient.Str(r["type"]) == "bell");
        var times = today.Select(r => (DoorClient.Time(r["repliedAt"]), DoorClient.Time(r["createdAt"]))).Where(t => t.Item1 != null && t.Item2 != null && t.Item1 >= t.Item2).Select(t => (t.Item1!.Value - t.Item2!.Value).TotalMinutes).ToList();
        var avg = times.Count == 0 ? "—" : $"{Math.Max(1, (int)Math.Round(times.Average()))} min";
        var g = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*,*,*") };
        var tiles = new[] { (today.Count.ToString(), "bezoekers vandaag"), (waiting.ToString(), "wachten op antwoord"), (bells.ToString(), "keer aangebeld"), (avg, "gemiddeld antwoord") };
        for (int i = 0; i < tiles.Length; i++)
        {
            var t = Ui.Card(Ui.Stack(2, Ui.Text(tiles[i].Item1, 28, true, Ui.Brush(Ui.Accent)), Ui.Text(tiles[i].Item2, 12, false, Ui.Muted)), 14);
            t.Margin = new Thickness(i == 0 ? 0 : 6, 0, i == tiles.Length - 1 ? 0 : 6, 0);
            Grid.SetColumn(t, i); g.Children.Add(t);
        }
        return g;
    }

    Control? QuickBar()
    {
        var list = AppSettings.Current.Quick;
        if (list.Count == 0) return null;
        var buttons = list.Select(q => (Control)Ui.Btn(q.Name + (q.Minutes > 0 ? $" · {q.Minutes} min" : ""), () => Run($"{q.Name}: {(q.Mode == "open" ? "Open" : q.Mode == "closed" ? "Gesloten" : "Bezet")}", () => RunQuick(q)), Ui.Alpha(Ui.Hex(q.Mode), "55"))).ToArray();
        return Ui.Card(Ui.Stack(10, Ui.Text("Snelle acties", 16, true), Ui.Wrap(8, buttons)));
    }

    public Task RunQuick(QuickAction q)
    {
        var b = new JsonObject { ["mode"] = q.Mode };
        if (q.Minutes > 0) b["minutes"] = q.Minutes;
        if (q.Message != "") b["message"] = q.Message;
        return C.PostAsync("/api/status", b);
    }

    async void ExportCsv()
    {
        try
        {
            string Q(string v) => "\"" + v.Replace("\"", "\"\"") + "\"";
            var sb = new System.Text.StringBuilder("Tijd,Soort,Naam,Nummer,Onderwerp,Bericht,Antwoord,Status\n");
            foreach (var r in C.Requests.OrderBy(r => DoorClient.Time(r["createdAt"])))
                sb.AppendLine(string.Join(",", new[] { (DoorClient.Time(r["createdAt"]) ?? DateTime.Now).ToString("yyyy-MM-dd HH:mm"), VisitLabel(r), DoorClient.Str(r["name"]), DoorClient.Str(r["nr"]), DoorClient.Str(r["topic"]), DoorClient.Str(r["message"]), DoorClient.Str(r["reply"]), DoorClient.Str(r["state"]) }.Select(Q)));
            var file = await StorageProvider.SaveFilePickerAsync(new Avalonia.Platform.Storage.FilePickerSaveOptions { SuggestedFileName = "bezoekers.csv", DefaultExtension = "csv", Title = "Bezoekers opslaan" });
            if (file == null) return;
            await using var stream = await file.OpenWriteAsync();
            await stream.WriteAsync(new System.Text.UTF8Encoding(true).GetBytes(sb.ToString()));
            Toast("Opgeslagen");
        }
        catch (Exception e) { Toast(e.Message); }
    }

    // ---------- settings: account, looks, quick actions, quiet hours ----------
    Control SettingsPage()
    {
        var connect = (StackPanel)ConnectPage(); connect.Margin = new Thickness(0);
        var s = AppSettings.Current;

        Control Choice(string id, string label) => Ui.Btn(label, () => { s.Appearance = id; s.Save(); Redraw(); }, s.Appearance == id ? Ui.Accent : Ui.Soft, s.Appearance == id ? "#000000" : null);
        var swatches = new List<Control>();
        foreach (var (hex, name) in new[] { ("", "Volg de server"), ("#30d158", "Groen"), ("#0a84ff", "Blauw"), ("#bf5af2", "Paars"), ("#ff375f", "Roze"), ("#ff9f0a", "Oranje"), ("#64d2ff", "Lucht") })
        {
            var h = hex; var shown = hex == "" ? Ui.Accent : hex;
            var b = new Button { Width = 34, Height = 34, CornerRadius = new CornerRadius(17), Background = Ui.Brush(shown), Content = Ui.Text(s.Accent == h ? "✓" : "", 14, true, Ui.Brush("#000000")), HorizontalContentAlignment = HorizontalAlignment.Center, Padding = new Thickness(0) };
            ToolTip.SetTip(b, name);
            b.Click += (_, _) => { s.Accent = h; s.Save(); Redraw(); };
            swatches.Add(b);
        }
        var look = Ui.Card(Ui.Stack(12, Ui.Text("Uiterlijk", 16, true),
            Ui.Row(8, Choice("system", "Zoals dit systeem"), Choice("light", "Licht"), Choice("dark", "Donker")),
            Ui.Wrap(8, swatches.ToArray()),
            Ui.Text("Dit geldt alleen voor deze app op deze computer. De kleuren van Open, Gesloten en Bezet volgen het thema van de server.", 12, false, Ui.Muted)));

        var rows = new StackPanel { Spacing = 8 };
        void Draw()
        {
            rows.Children.Clear();
            foreach (var q in s.Quick.ToList())
            {
                var mode = new ComboBox { ItemsSource = new[] { "Open", "Gesloten", "Bezet" }, SelectedIndex = q.Mode == "open" ? 0 : q.Mode == "closed" ? 1 : 2, Width = 120 };
                mode.SelectionChanged += (_, _) => q.Mode = mode.SelectedIndex switch { 0 => "open", 1 => "closed", _ => "busy" };
                var min = new NumericUpDown { Minimum = 0, Maximum = 600, Increment = 5, Value = q.Minutes, Width = 120, FormatString = "0" };
                min.ValueChanged += (_, e) => q.Minutes = (int)(e.NewValue ?? 0);
                rows.Children.Add(Ui.Row(8, Ui.Input(q.Name, "Naam", t => q.Name = t).W(150), mode, min, Ui.Text("min (0 = geen limiet)", 12, false, Ui.Muted), Ui.Input(q.Message, "Bericht op de deur", t => q.Message = t).W(260),
                    Ui.Btn("✕", () => { s.Quick.Remove(q); Draw(); }, Ui.DangerSoft, padV: 6, padH: 12)));
            }
        }
        Draw();
        var quick = Ui.Card(Ui.Stack(10, Ui.Text("Snelle acties", 16, true),
            Ui.Text("Eén klik zet de deur op een status, voor een tijd, met een bericht. Ze staan op de Status-pagina en in het menu van het icoon bij de klok.", 12, false, Ui.Muted), rows,
            Ui.Row(8, Ui.Btn("+ Actie toevoegen", () => { s.Quick.Add(new QuickAction()); Draw(); }, Ui.Soft), Ui.Btn("Opslaan", () => { s.Save(); (Application.Current as App)?.RefreshTray(); Toast("Opgeslagen"); Redraw(); }, Ui.Accent, "#000000"))));

        var from = new TimePicker { SelectedTime = TimeSpan.FromMinutes(s.QuietFrom), ClockIdentifier = "24HourClock", MinuteIncrement = 5 };
        var to = new TimePicker { SelectedTime = TimeSpan.FromMinutes(s.QuietTo), ClockIdentifier = "24HourClock", MinuteIncrement = 5 };
        from.SelectedTimeChanged += (_, e) => { if (e.NewTime != null) { s.QuietFrom = (int)e.NewTime.Value.TotalMinutes; s.Save(); } };
        to.SelectedTimeChanged += (_, e) => { if (e.NewTime != null) { s.QuietTo = (int)e.NewTime.Value.TotalMinutes; s.Save(); } };
        var on = new CheckBox { Content = "Geen geluid in deze uren", IsChecked = s.QuietOn, Foreground = Ui.White };
        on.IsCheckedChanged += (_, _) => { s.QuietOn = on.IsChecked == true; s.Save(); };
        var quiet = Ui.Card(Ui.Stack(10, Ui.Text("Stille uren", 16, true), on, Ui.Row(10, Ui.Text("Van", 13), from, Ui.Text("tot", 13), to),
            Ui.Text("Bezoekers blijven gewoon in de lijst; alleen het geluid blijft weg.", 12, false, Ui.Muted)));

        return Ui.Page(connect, look, quick, quiet);
    }

    // ---------- developer page (only in the Dev app) ----------
    Control DevPage()
    {
        var methodBox = new ComboBox { ItemsSource = new[] { "GET", "POST" }, SelectedItem = _devMethod, Width = 90 };
        methodBox.SelectionChanged += (_, _) => _devMethod = methodBox.SelectedItem as string ?? "GET";
        var path = Ui.Input(_devPath, "pad, bijv. api/admin-state", t => _devPath = t).W(420);
        var body = new TextBox { Text = _devBody, AcceptsReturn = true, Height = 90, Watermark = "Inhoud (JSON), alleen bij POST", FontFamily = new FontFamily("Consolas, Menlo, monospace") };
        body.TextChanged += (_, _) => _devBody = body.Text ?? "";
        var output = new TextBox { Text = _devOut, IsReadOnly = true, AcceptsReturn = true, Height = 260, FontFamily = new FontFamily("Consolas, Menlo, monospace"), TextWrapping = TextWrapping.Wrap };
        async void Send()
        {
            try
            {
                JsonNode? b = null;
                if (_devMethod == "POST" && _devBody.Trim() != "") b = JsonNode.Parse(_devBody);
                var t0 = DateTime.UtcNow;
                var res = await C.CallAsync(_devMethod, "/" + _devPath.Trim().TrimStart('/'), b);
                _devOut = $"// {(int)(DateTime.UtcNow - t0).TotalMilliseconds} ms\n" + (res?.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }) ?? "null");
            }
            catch (Exception e) { _devOut = "Fout: " + e.Message; }
            output.Text = _devOut;
        }
        var console = Ui.Card(Ui.Stack(10, Ui.Text("API-console", 16, true), Ui.Row(8, methodBox, path, Ui.Btn("Versturen", Send, Ui.Accent, "#000000")), body, output));

        var parts = new[] { "view", "settings", "me", "requests", "power", "health", "integ", "devices", "sightings", "server", "system" };
        var partBox = new ComboBox { ItemsSource = parts, SelectedItem = _devPart, Width = 200 };
        var raw = new TextBox { IsReadOnly = true, AcceptsReturn = true, Height = 240, FontFamily = new FontFamily("Consolas, Menlo, monospace"), TextWrapping = TextWrapping.Wrap };
        void Show() => raw.Text = C.State[_devPart]?.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }) ?? "null";
        partBox.SelectionChanged += (_, _) => { _devPart = partBox.SelectedItem as string ?? "view"; Show(); };
        Show();
        var data = Ui.Card(Ui.Stack(10, Ui.Text("Gegevens van de server", 16, true), partBox, raw));

        string logText; lock (C.Log) logText = string.Join("\n", C.Log);
        var log = Ui.Card(Ui.Stack(10, Ui.Text("Gebeurtenissen", 16, true), new TextBox { Text = logText, IsReadOnly = true, AcceptsReturn = true, Height = 200, FontFamily = new FontFamily("Consolas, Menlo, monospace") }));
        var info = Ui.Card(Ui.Stack(4, Ui.Text("Verbinding", 16, true), Ui.Text($"Server: {C.Server}", 13, false, Ui.Muted), Ui.Text($"Reactietijd: {C.LatencyMs} ms", 13, false, Ui.Muted),
            Ui.Text($"Rechten: {string.Join(", ", C.Perms)}", 13, false, Ui.Muted), Ui.Text($"App: {typeof(MainWindow).Assembly.GetName().Version} · {System.Runtime.InteropServices.RuntimeInformation.OSDescription}", 13, false, Ui.Muted)));
        return Ui.Page(console, data, log, info);
    }
}
