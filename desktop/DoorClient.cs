using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SagaTechbox;

/// Talks to the door server: logs in, keeps the data live through the same event stream the web panel uses, and sends changes.
public sealed class DoorClient
{
    public static readonly DoorClient Shared = new();
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    public string Server = "";
    string? _token;
    CancellationTokenSource? _cts;
    public JsonNode State { get; private set; } = new JsonObject();
    public bool HasState { get; private set; }
    public string Connection { get; private set; } = "Niet verbonden";
    public bool Live { get; private set; }
    public int LatencyMs { get; private set; }

    public event Action? Changed;
    public event Action<JsonNode>? Visit;
    public event Action? Ring;

    // ---- the values the screens need ----
    public string Name => Str(State["settings"]?["name"], "Deur");
    public string Mode => Str(State["view"]?["mode"], "closed");
    public string Label => Str(State["view"]?["label"], "");
    public string Message => Str(State["view"]?["message"], "");
    public DateTime? Until => Time(State["view"]?["until"]);
    public IReadOnlyList<string> Perms => (State["me"]?["perms"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").ToList() ?? new();
    public bool Can(string p) => Perms.Contains(p);
    public IEnumerable<JsonNode> Requests => (State["requests"] as JsonArray)?.Where(x => x != null).Select(x => x!).OrderByDescending(x => x["createdAt"]?.GetValue<double>() ?? 0) ?? Enumerable.Empty<JsonNode>();
    public int NewCount => Requests.Count(r => Str(r["state"]) == "new");
    public IReadOnlyList<string> QuickReplies => (State["settings"]?["quickReplies"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x != "").ToList() ?? new();

    public static string Str(JsonNode? n, string d = "") { try { return n?.GetValue<string>() ?? d; } catch { return n?.ToString() ?? d; } }
    public static DateTime? Time(JsonNode? n) { try { return n == null ? null : DateTimeOffset.FromUnixTimeMilliseconds((long)n.GetValue<double>()).LocalDateTime; } catch { return null; } }
    public static double Ms(DateTime t) => new DateTimeOffset(t.ToUniversalTime()).ToUnixTimeMilliseconds();

    public static string Normalize(string raw)
    {
        var s = raw.Trim();
        if (s.Length == 0) return "";
        if (!s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) s = "http://" + s;
        return s.TrimEnd('/');
    }

    // ---- login ----
    public async Task<string> LoginAsync(string server, string user, string pass)
    {
        var url = Normalize(server);
        if (url == "") throw new Exception("Dat adres klopt niet.");
        HttpResponseMessage res;
        try { res = await Http.PostAsync(url + "/api/login", Json(new JsonObject { ["username"] = user.Trim().ToLowerInvariant(), ["password"] = pass, ["remember"] = true })); }
        catch { throw new Exception("Geen verbinding met de deurserver."); }
        var body = JsonNode.Parse(await res.Content.ReadAsStringAsync());
        if (res.IsSuccessStatusCode && body?["token"] != null) return body["token"]!.GetValue<string>();
        if ((int)res.StatusCode == 401) throw new Exception("Gebruikersnaam of wachtwoord klopt niet.");
        throw new Exception(Str(body?["error"], $"Inloggen lukte niet ({(int)res.StatusCode})."));
    }

    // ---- start / stop ----
    public void Start()
    {
        Stop();
        var creds = Credentials.Load();
        if (creds == null) return;
        Server = Normalize(creds.Server);
        _cts = new CancellationTokenSource();
        _ = Loop(creds, _cts.Token);
    }

    public void Stop() { _cts?.Cancel(); _cts = null; _token = null; Live = false; }

    void Set(string text, bool live) { Connection = text; Live = live; Changed?.Invoke(); }

    async Task Loop(Credentials creds, CancellationToken ct)
    {
        int failures = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                Set("Verbinden…", false);
                _token = await LoginAsync(creds.Server, creds.User, creds.Pass);
                await RefreshAsync();
                failures = 0;
                await Listen(ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e)
            {
                failures++;
                Set(e.Message, false);
                if (e.Message.StartsWith("Gebruikersnaam")) break; // wrong login: do not keep trying
            }
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Min(30, 2 + failures * 3)), ct); } catch { break; }
        }
    }

    public async Task RefreshAsync()
    {
        var t0 = DateTime.UtcNow;
        var node = await CallAsync("GET", "/api/admin-state");
        LatencyMs = (int)(DateTime.UtcNow - t0).TotalMilliseconds;
        State = node ?? new JsonObject(); HasState = true;
        Set("Live", true);
    }

    async Task Listen(CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, $"{Server}/events?role=admin&token={Uri.EscapeDataString(_token ?? "")}");
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        using var client = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        using var res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!res.IsSuccessStatusCode) throw new Exception("De live verbinding gaf een fout.");
        Set("Live", true);
        using var stream = await res.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        string ev = "message", data = "";
        while (!ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line == null) break;
            if (line.StartsWith("event:")) ev = line[6..].Trim();
            else if (line.StartsWith("data:")) data += line[5..].Trim();
            else if (line.Length == 0)
            {
                if (data != "") Handle(ev, data);
                ev = "message"; data = "";
            }
        }
        throw new Exception("De verbinding werd gesloten door de server.");
    }

    void Handle(string ev, string data)
    {
        JsonNode? j = null; try { j = JsonNode.Parse(data); } catch { }
        switch (ev)
        {
            case "state": if (j != null) { State = j; HasState = true; Changed?.Invoke(); } break;
            case "visit": if (j != null) Visit?.Invoke(j); break;
            case "ring": Ring?.Invoke(); break;
        }
    }

    // ---- calls ----
    public async Task<JsonNode?> CallAsync(string method, string path, JsonNode? body = null)
    {
        for (int attempt = 0; attempt < 2; attempt++)
        {
            var req = new HttpRequestMessage(new HttpMethod(method), Server + path);
            if (_token != null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
            if (body != null) req.Content = Json(body); else if (method == "POST") req.Content = Json(new JsonObject());
            HttpResponseMessage res;
            try { res = await Http.SendAsync(req); } catch { throw new Exception("Geen verbinding met de deurserver."); }
            if ((int)res.StatusCode == 401 && attempt == 0 && Credentials.Load() is { } c) { _token = await LoginAsync(c.Server, c.User, c.Pass); continue; }
            var text = await res.Content.ReadAsStringAsync();
            JsonNode? node = null; try { node = JsonNode.Parse(text); } catch { }
            if (!res.IsSuccessStatusCode) throw new Exception(Str(node?["error"], $"Dat lukte niet ({(int)res.StatusCode})."));
            return node;
        }
        return null;
    }

    /// A change on the server; refreshes afterwards so the screen is right at once.
    public async Task PostAsync(string path, JsonObject? body = null)
    {
        await CallAsync("POST", path, body ?? new JsonObject());
        try { await RefreshAsync(); } catch { }
    }

    public Task SetStatusAsync(string mode, int? minutes = null, DateTime? until = null)
    {
        var b = new JsonObject { ["mode"] = mode };
        if (minutes != null) b["minutes"] = minutes;
        if (until != null) b["until"] = Ms(until.Value);
        return PostAsync("/api/status", b);
    }

    static StringContent Json(JsonNode n) => new(n.ToJsonString(), Encoding.UTF8, "application/json");

    // ---- find servers on the network (same small broadcast the phone app uses) ----
    public record Found(string Name, string Host, int Port, string Version) { public string Url => $"http://{Host}:{Port}"; }

    public static async Task<List<Found>> DiscoverAsync(int ms = 1800)
    {
        var found = new List<Found>();
        try
        {
            using var udp = new UdpClient { EnableBroadcast = true };
            await udp.SendAsync(Encoding.ASCII.GetBytes("SAGA-DOOR?"), new IPEndPoint(IPAddress.Broadcast, 41234));
            var until = DateTime.UtcNow.AddMilliseconds(ms);
            while (DateTime.UtcNow < until)
            {
                var task = udp.ReceiveAsync();
                if (await Task.WhenAny(task, Task.Delay(300)) != task) continue;
                var r = task.Result;
                try
                {
                    var j = JsonNode.Parse(Encoding.UTF8.GetString(r.Buffer));
                    if (Str(j?["app"]) == "") continue;
                    var f = new Found(Str(j!["name"], "Deurserver"), r.RemoteEndPoint.Address.ToString(), j["port"]?.GetValue<int>() ?? 8080, Str(j["version"]));
                    if (!found.Any(x => x.Host == f.Host && x.Port == f.Port)) found.Add(f);
                }
                catch { }
            }
        }
        catch { }
        return found;
    }
}
