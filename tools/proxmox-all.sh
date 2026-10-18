#!/usr/bin/env bash
# Doet alles in één keer op je Proxmox-server (als root, in de Shell van de server):
#   1. haalt de Saga Techbox-schijf (ISO) op
#   2. maakt een TESTMACHINE, start hem en test alles (machine, firewall, netwerk en alle onderdelen van de server)
#   3. ruimt de testmachine weer op
#   4. maakt de ECHTE machine klaar en laat zien hoe je erin komt
#   5. schrijft een verslag, en als er iets niet werkt een tekst die je aan Claude kunt geven
# Er wordt niets van je andere machines verwijderd of gewijzigd.
#
#   ISO_URL="https://…" ./proxmox-all.sh           (de link krijg je van Claude)
#   ./proxmox-all.sh "https://…" --keep-test        (de testmachine laten staan)
#   OPTIES: --keep-test  --skip-real  --bridge vmbr0  --vmid-test 9400
set -uo pipefail

ISO_URL="${ISO_URL:-}"; KEEP_TEST=0; SKIP_REAL=0; BRIDGE=vmbr0; ISOSTORE=local; ISO_NAME=Saga-Techbox-Deur-OS-amd64.iso
while [ $# -gt 0 ]; do
  case "$1" in
    http*) ISO_URL="$1" ;;
    --keep-test) KEEP_TEST=1 ;;
    --skip-real) SKIP_REAL=1 ;;
    --bridge) BRIDGE="$2"; shift ;;
    --iso-name) ISO_NAME="$2"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
  esac
  shift
done
[ -n "$ISO_URL" ] || { echo "Geef de link van de schijf mee:  ISO_URL=\"https://…\" ./proxmox-all.sh"; exit 2; }
command -v qm >/dev/null || { echo "Dit script moet in de Shell van de Proxmox-server draaien (het commando 'qm' ontbreekt)."; exit 2; }
command -v python3 >/dev/null || { echo "python3 ontbreekt op deze server."; exit 2; }

REPORT=/root/saga-test-rapport-$(date +%Y%m%d-%H%M).txt
PASS=0; FAIL=0; WARN=0; FAILS=()
say()  { echo "$*" | tee -a "$REPORT"; }
ok()   { PASS=$((PASS+1)); say "  ✓ $1"; }
warnx(){ WARN=$((WARN+1)); FAILS+=("[LET OP] $1: $2"); say "  ! $1 — $2"; }
bad()  { FAIL=$((FAIL+1)); FAILS+=("[MISLUKT] $1: $2"); say "  ✗ $1 — $2"; }
TESTVM=""; REALVM=""
cleanup_test() {
  if [ -n "$TESTVM" ] && [ "$KEEP_TEST" = 0 ]; then
    say "Testmachine $TESTVM opruimen…"
    qm stop "$TESTVM" --skiplock 1 >/dev/null 2>&1; qm destroy "$TESTVM" --purge 1 --destroy-unreferenced-disks 1 >/dev/null 2>&1; TESTVM=""
  fi
}
trap cleanup_test EXIT

# een machine maken en starten; schrijft het nummer terug in $NEWVM
NEWVM=""
make_vm() {
  local name="$1" id
  id=$(pvesh get /cluster/nextid 2>/dev/null) || { bad "machine maken" "kon geen vrij nummer vinden"; return 1; }
  qm create "$id" --name "$name" --memory 2048 --cores 2 --ostype l26 --agent 1 --net0 "virtio,bridge=$BRIDGE" \
     --ide2 "$ISOSTORE:iso/$ISO_NAME,media=cdrom" --boot order=ide2 --vga std >/dev/null 2>&1 || { bad "machine maken" "qm create mislukte (bestaat de bridge $BRIDGE?)"; return 1; }
  qm start "$id" >/dev/null 2>&1 || { bad "machine starten" "qm start mislukte"; qm destroy "$id" --purge 1 >/dev/null 2>&1; return 1; }
  NEWVM="$id"
}
wait_ip() {   # $1 = machine; schrijft het adres naar $VMIP
  VMIP=""
  for i in $(seq 1 60); do
    sleep 5
    VMIP=$(qm guest cmd "$1" network-get-interfaces 2>/dev/null | python3 -c '
import json,sys
try:
    for n in json.load(sys.stdin):
        for a in n.get("ip-addresses", []):
            if a.get("ip-address-type") == "ipv4" and not a["ip-address"].startswith(("127.", "169.254.")):
                print(a["ip-address"]); raise SystemExit
except Exception:
    pass
' 2>/dev/null || true)
    [ -n "$VMIP" ] && return 0
  done
  return 1
}
wait_http() { for i in $(seq 1 60); do curl -fsS -m 4 "http://$1:8080/healthz" >/dev/null 2>&1 && return 0; sleep 3; done; return 1; }
# een opdracht in de machine uitvoeren (via de gast-agent); schrijft de uitvoer naar $GXOUT en de afsluitcode naar $GXCODE
gx() {
  local vm="$1"; shift
  local raw; raw=$(qm guest exec "$vm" --timeout 280 -- "$@" 2>/dev/null) || { GXOUT=""; GXCODE=127; return 1; }
  GXOUT=$(printf '%s' "$raw" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("out-data","")+d.get("err-data",""), end="")' 2>/dev/null)
  GXCODE=$(printf '%s' "$raw" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("exitcode",1))' 2>/dev/null)
  return 0
}

: > "$REPORT"
say "Saga Techbox — alles testen op Proxmox ($(date '+%Y-%m-%d %H:%M'))"
say "Verslag wordt bewaard in $REPORT"
say ""

# 1. de schijf ophalen
say "1/5  De schijf ophalen (ongeveer 620 MB)…"
ISODIR=$(pvesm path "$ISOSTORE:iso/$ISO_NAME" 2>/dev/null | xargs -r dirname); ISODIR=${ISODIR:-/var/lib/vz/template/iso}
if ! wget -q --show-progress -O "$ISODIR/$ISO_NAME" "$ISO_URL"; then bad "schijf ophalen" "de link werkt niet (meer). Vraag Claude om een nieuwe link."; exit 1; fi
SIZE=$(stat -c %s "$ISODIR/$ISO_NAME"); [ "$SIZE" -gt 300000000 ] && ok "schijf opgehaald ($((SIZE/1048576)) MB)" || { bad "schijf ophalen" "het bestand is te klein ($SIZE bytes)"; exit 1; }

# 2. de testmachine
say ""; say "2/5  Testmachine maken en starten…"
if make_vm "saga-deur-test"; then
  TESTVM="$NEWVM"; ok "testmachine $TESTVM gestart"
  if wait_ip "$TESTVM"; then ok "heeft adres $VMIP"; else bad "netwerk" "de testmachine kreeg geen adres (draait de gast-agent? staat bridge $BRIDGE aan een netwerk met DHCP?)"; fi
  if [ -n "${VMIP:-}" ]; then
    if wait_http "$VMIP"; then ok "de server antwoordt op http://$VMIP:8080"; else bad "server" "de server antwoordt niet op poort 8080"; fi
  fi
fi

if [ -n "$TESTVM" ] && [ -n "${VMIP:-}" ]; then
  say ""; say "3/5  Testen…"
  say " Van buiten gezien (vanaf de Proxmox-server):"
  for p in / /admin /visit /start /help /check; do
    c=$(curl -s -o /dev/null -m 6 -w '%{http_code}' "http://$VMIP:8080$p"); [ "$c" = 200 ] && ok "pagina $p" || bad "pagina $p" "antwoord $c"
  done
  H=$(curl -s -D - -o /dev/null -m 6 "http://$VMIP:8080/admin")
  echo "$H" | grep -qi "content-security-policy" && ok "beveiligingskoppen (CSP)" || bad "beveiligingskoppen" "geen Content-Security-Policy"
  for port in 22 23 5900 3000 8443; do
    if timeout 3 bash -c "exec 3<>/dev/tcp/$VMIP/$port" 2>/dev/null; then
      [ "$port" = 8443 ] && warnx "poort 8443" "staat open (https is aan)" || bad "poort $port" "staat open (hoort dicht te zijn)"
    else ok "poort $port is dicht"; fi
  done
  # de naam saga-deur.local, gevraagd zoals een computer het doet (mDNS)
  ANS=$(python3 - <<'PY' 2>/dev/null
import socket, struct, time
q = b"\x12\x34\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00" + b"\x09saga-deur\x05local\x00" + b"\x00\x01\x00\x01"
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(1.0)
s.sendto(q, ("224.0.0.251", 5353)); out = set(); end = time.time() + 4
while time.time() < end:
    try:
        d, a = s.recvfrom(2048)
        if len(d) > 12 and d[:2] == b"\x12\x34":
            out.add(".".join(str(b) for b in d[-4:]))
    except Exception:
        s.sendto(q, ("224.0.0.251", 5353))
print(" ".join(sorted(out)))
PY
)
  if echo "$ANS" | grep -q "$VMIP"; then ok "de naam saga-deur.local geeft het adres $VMIP (netwerk-test van buiten)"
  elif [ -n "$ANS" ]; then warnx "naam saga-deur.local" "antwoord van $ANS, maar niet van de testmachine ($VMIP): een andere machine gebruikt dezelfde naam"
  else warnx "naam saga-deur.local" "geen antwoord: het netwerk geeft deze berichten (mDNS) misschien niet door, of de server gebruikt een andere naam"; fi

  say " Binnen in de machine:"
  gx "$TESTVM" /bin/systemctl is-active saga-door nftables saga-harden avahi-daemon NetworkManager qemu-guest-agent
  i=0; for svc in saga-door nftables saga-harden avahi-daemon NetworkManager qemu-guest-agent; do
    i=$((i+1)); st=$(printf '%s\n' "$GXOUT" | sed -n "${i}p"); [ "$st" = active ] && ok "onderdeel $svc draait" || bad "onderdeel $svc" "status: ${st:-onbekend}"
  done
  gx "$TESTVM" /bin/sh -c 'systemctl is-enabled ssh 2>&1; true'
  case "$GXOUT" in *masked*|*"not-found"*|*"No such"*|*disabled*) ok "inloggen op afstand (ssh) staat uit" ;; *) warnx "ssh" "status: $(echo $GXOUT | head -c 60)" ;; esac
  gx "$TESTVM" /usr/sbin/nft list ruleset
  echo "$GXOUT" | grep -q "igmp" && ok "firewall laat de netwerkvraag van de router (IGMP) door" || bad "firewall" "de regel voor IGMP ontbreekt"
  echo "$GXOUT" | grep -q "policy drop" && ok "firewall weigert standaard alles wat niet nodig is" || bad "firewall" "geen 'policy drop'"
  gx "$TESTVM" /bin/sh -c 'ss -ulnp | grep -c ":5353" || true'
  [ "$(echo $GXOUT | tr -dc 0-9)" -ge 1 ] 2>/dev/null && ok "de naam wordt bekendgemaakt (poort 5353 luistert)" || bad "naam in het netwerk" "niets luistert op poort 5353"
  gx "$TESTVM" /usr/bin/node --version; echo "$GXOUT" | grep -q '^v' && ok "Node ${GXOUT//$'\n'/}" || bad "Node" "niet gevonden"
  gx "$TESTVM" /bin/sh -c 'free -m | sed -n 2p; df -h / | tail -1'; say "    $(echo "$GXOUT" | head -2 | tr '\n' ' ')"

  say " De server zelf (alle onderdelen, op een tijdelijke kopie in de machine):"
  gx "$TESTVM" /usr/bin/node /opt/saga-door/check-selftest.js --json
  JSONLINE=$(printf '%s\n' "$GXOUT" | tail -n 1)
  if printf '%s' "$JSONLINE" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1; then
    while IFS=$'\t' read -r st grp name detail; do
      case "$st" in ok) ok "$grp → $name" ;; bad) bad "$grp → $name" "$detail" ;; warn) warnx "$grp → $name" "$detail" ;; skip) : ;; esac
    done < <(printf '%s' "$JSONLINE" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for r in d["results"]:
    print("\t".join([r["state"], r["group"], r["name"], (r.get("detail") or "").replace("\n"," ")]))')
  else
    bad "de server testen" "de test in de machine gaf geen uitslag: $(echo "$GXOUT" | tail -n 3 | tr '\n' ' ' | head -c 300)"
  fi
fi

# 4. opruimen en de echte machine
say ""; say "4/5  Opruimen…"
cleanup_test
if [ "$SKIP_REAL" = 0 ]; then
  say ""; say "5/5  De echte machine klaarzetten…"
  if make_vm "saga-deur"; then
    REALVM="$NEWVM"; ok "machine $REALVM gestart"
    if wait_ip "$REALVM"; then
      wait_http "$VMIP" && ok "de server draait op http://$VMIP:8080" || bad "echte machine" "de server antwoordt niet"
      sleep 3; gx "$REALVM" /bin/cat /var/lib/saga-door/starter-password.txt
      PW=$(printf '%s' "$GXOUT" | head -n 1 | tr -d '\r')
      REALIP="$VMIP"
    else bad "echte machine" "geen adres gekregen"; fi
  fi
fi

say ""; say "============================================================"
say "Uitslag: $PASS gelukt, $FAIL mislukt, $WARN aandachtspunt(en)"
if [ -n "$REALVM" ] && [ -n "${REALIP:-}" ]; then
  say ""
  say "Je nieuwe server (machine $REALVM):"
  say "   Paneel:        http://$REALIP:8080/admin"
  say "   Alles testen:  http://$REALIP:8080/check   (log in met milo)"
  [ -n "${PW:-}" ] && say "   Startaccount:  admin  /  $(echo "$PW" | sed 's/^[^:]*: *//')"
  say "   Je gegevens van de oude server zet je over met: Instellingen → Meer → Back-up terugzetten,"
  say "   of op de nieuwe server: Systeem → Gegevens overzetten (met milo)."
fi
if [ "$FAIL" -gt 0 ] || [ "$WARN" -gt 0 ]; then
  say ""
  say "------------------------------------------------------------"
  say "TEKST VOOR CLAUDE (kopieer alles hieronder en plak het in het gesprek):"
  say ""
  say "Ik heb het testscript voor Proxmox (tools/proxmox-all.sh) van Saga Techbox gedraaid."
  say "Proxmox: $(pveversion 2>/dev/null | head -n 1). Bridge: $BRIDGE."
  [ "$FAIL" -gt 0 ] && say "Deze onderdelen werken niet goed:" || say "Alles werkt, maar hier moet je naar kijken:"
  for f in "${FAILS[@]}"; do say "- $f"; done
  say ""
  say "Zoek uit waarom dit niet werkt, los het op, test het en breng een nieuwe developer beta uit (pre-release, geen gewone versie). Zeg daarna kort wat je gedaan hebt en wat ik zelf moet proberen."
  say "------------------------------------------------------------"
else
  say ""; say "Alles werkt. Er is niets om aan Claude te geven."
fi
say ""; say "Het verslag staat ook in $REPORT"
[ "$FAIL" = 0 ]
