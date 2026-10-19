#!/usr/bin/env bash
# Werkt je bestaande Saga Techbox-machine in Proxmox bij naar de nieuwste schijf (ISO). Eén opdracht, in de Shell van de Proxmox-server:
#
#   bash <(wget -qO- https://raw.githubusercontent.com/Milo289/saga-techbox-door/main/tools/proxmox-update.sh)
#
# Wat het doet (en niets anders):
#   1. zoekt je Saga-machine (of vraagt welke), en de nieuwste uitgave op GitHub
#   2. downloadt de nieuwe schijf naar je ISO-opslag
#   3. zet hem in het dvd-station van je machine (de machine zelf blijft, ook je instellingen van Proxmox)
#   4. geeft de machine een lege schijf van 4 GB voor je gegevens, ALS hij nog geen schijf heeft
#   5. start de machine opnieuw en wacht tot de server antwoordt
# Een schijf die al in de machine zit wordt nooit aangeraakt. Oude ISO-bestanden worden niet verwijderd.
#
#   OPTIES:  123 (het nummer van de machine)   --ja (niet om bevestiging vragen)   --stabiel (alleen gewone versies)
#            --opslag NAAM (waar de gegevensschijf komt)   --geen-schijf (geen gegevensschijf toevoegen)
set -uo pipefail

REPO="Milo289/saga-techbox-door"; VMID=""; YES=0; STABLE=0; STORE=""; NODISK=0; ISO_NAME_BASE="Saga-Techbox-Deur-OS-amd64"
MIN_MB="${SAGA_MIN_ISO_MB:-200}"
while [ $# -gt 0 ]; do
  case "$1" in
    --ja|-y) YES=1 ;; --stabiel) STABLE=1 ;; --geen-schijf) NODISK=1 ;;
    --opslag) STORE="${2:-}"; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    [0-9]*) VMID="$1" ;;
  esac
  shift
done
say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }
command -v qm >/dev/null 2>&1 || die "Dit moet in de Shell van de Proxmox-server draaien (het commando 'qm' ontbreekt)."
command -v python3 >/dev/null 2>&1 || die "python3 ontbreekt op deze server."
[ "$(id -u)" = 0 ] || [ -n "${SAGA_TEST:-}" ] || die "Draai dit als root (in de Shell van Proxmox ben je dat al)."
ask() { # vraag, standaard nee
  [ "$YES" = 1 ] && return 0
  [ -t 0 ] || { say "(geen toetsenbord beschikbaar: voeg --ja toe om door te gaan)"; return 1; }
  local a; read -r -p "$1 [j/N] " a; case "$a" in j|J|y|Y) return 0 ;; *) return 1 ;; esac
}

# ---------- 1. de machine ----------
cfg() { qm config "$1" 2>/dev/null; }
if [ -z "$VMID" ]; then
  CAND=()
  while read -r id name _; do
    [ -z "${id:-}" ] && continue
    case "$id" in [0-9]*) ;; *) continue ;; esac
    C=$(cfg "$id"); if grep -qi 'saga-techbox' <<<"$C" || grep -qiE 'saga|techbox|deur' <<<"$name"; then CAND+=("$id"); fi
  done < <(qm list 2>/dev/null | tail -n +2 | awk '{print $1, $2}')
  if [ "${#CAND[@]}" = 1 ]; then VMID="${CAND[0]}"
  else
    say "Welke machine is je Saga Techbox?"; qm list
    [ -t 0 ] || die "Geef het nummer van de machine mee, bijvoorbeeld:  bash proxmox-update.sh 100"
    read -r -p "Nummer van de machine: " VMID
  fi
fi
case "$VMID" in ''|*[!0-9]*) die "Dat is geen machinenummer: '$VMID'" ;; esac
CFG=$(cfg "$VMID"); [ -n "$CFG" ] || die "Machine $VMID bestaat niet."
VMNAME=$(awk -F': ' '$1=="name"{print $2}' <<<"$CFG")
say "Machine: $VMID ($VMNAME)"

# ---------- 2. de nieuwste uitgave ----------
say "Zoeken naar de nieuwste versie op GitHub…"
JSON=$(wget -qO- --header="User-Agent: saga-update" "https://api.github.com/repos/$REPO/releases?per_page=30" 2>/dev/null) || die "Geen verbinding met GitHub."
PICK=$(printf '%s' "$JSON" | STABLE="$STABLE" python3 -c '
import json, os, sys
try: rels = json.load(sys.stdin)
except Exception: sys.exit(1)
for r in rels:
    if r.get("draft") or (os.environ.get("STABLE") == "1" and r.get("prerelease")): continue
    for a in r.get("assets", []):
        if a.get("name") == "Saga-Techbox-Deur-OS-amd64.iso":
            print(r["tag_name"], a["browser_download_url"], a.get("size", 0)); sys.exit(0)
sys.exit(2)') || die "Ik vond geen schijf (ISO) bij de uitgaven."
TAG=${PICK%% *}; REST=${PICK#* }; URL=${REST%% *}; SIZE=${REST##* }
ISO_NAME="${ISO_NAME_BASE}-${TAG}.iso"
say "Nieuwste versie: $TAG ($((SIZE/1048576)) MB)"

# ---------- 3. waar de ISO heen moet ----------
ISOSTORE="${SAGA_ISO_STORE:-}"
if [ -z "$ISOSTORE" ]; then ISOSTORE=$(pvesm status --content iso 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}'); fi
[ -n "$ISOSTORE" ] || die "Geen opslag gevonden voor ISO-bestanden (Datacenter → Storage → Content: ISO image)."
ISODIR=$(python3 - "$ISOSTORE" <<'PY'
import re, sys
want, cur, path = sys.argv[1], None, {}
import os
for line in open(os.environ.get("SAGA_STORAGE_CFG", "/etc/pve/storage.cfg")):
    m = re.match(r"^\w+:\s*(\S+)", line)
    if m: cur = m.group(1); continue
    m = re.match(r"^\s+path\s+(\S+)", line)
    if m and cur: path[cur] = m.group(1)
print((path.get(want) or ("/var/lib/vz" if want == "local" else "")) + "/template/iso")
PY
)
[ -d "${ISODIR%/template/iso}" ] || die "Kon de map van opslag '$ISOSTORE' niet vinden."
say "ISO-opslag: $ISOSTORE ($ISODIR)"

# ---------- 4. de gegevensschijf ----------
HASDISK=0
DISKS=$(grep -E '^(scsi|virtio|sata|ide)[0-9]+:' <<<"$CFG" | grep -v 'media=cdrom' || true); [ -n "$DISKS" ] && HASDISK=1
ADDSTORE=""
if [ "$HASDISK" = 0 ] && [ "$NODISK" = 0 ]; then
  ADDSTORE="${STORE:-$(pvesm status --content images 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')}"
  [ -n "$ADDSTORE" ] || die "Geen opslag gevonden voor een gegevensschijf. Kies er een met --opslag NAAM (zie Datacenter → Storage)."
fi

say ""
say "Dit gaat gebeuren met machine $VMID:"
say "  • de machine wordt uitgezet en opnieuw gestart met de schijf van $TAG"
[ -n "$ADDSTORE" ] && say "  • er komt een lege gegevensschijf van 4 GB bij op '$ADDSTORE' (nu is er geen)" || { [ "$HASDISK" = 1 ] && say "  • de schijf die al in de machine zit blijft ongemoeid"; }
[ "$HASDISK" = 0 ] && [ "$NODISK" = 1 ] && say "  • er komt GEEN gegevensschijf bij: alles in de machine verdwijnt bij elke herstart"
say "  Maak eerst een back-up in het paneel van de server als daar iets in staat dat je wilt houden (Instellingen → Meer → Back-up maken)."
ask "Doorgaan?" || die "Gestopt. Er is niets veranderd."

# ---------- 5. downloaden ----------
mkdir -p "$ISODIR"
TARGET="$ISODIR/$ISO_NAME"
if [ -s "$TARGET" ] && [ "$(wc -c < "$TARGET" 2>/dev/null | tr -d " " || echo 0)" -ge $((MIN_MB * 1048576)) ]; then say "De schijf staat al klaar: $ISO_NAME"
else
  say "Downloaden…"
  wget -q --show-progress -O "$TARGET.part" "$URL" || { rm -f "$TARGET.part"; die "Downloaden mislukte."; }
  GOT=$(wc -c < "$TARGET.part" 2>/dev/null | tr -d " " || echo 0)
  [ "$GOT" -ge $((MIN_MB * 1048576)) ] || { rm -f "$TARGET.part"; die "Het gedownloade bestand is te klein ($((GOT/1048576)) MB): er ging iets mis. Er is niets veranderd."; }
  [ "$SIZE" = 0 ] || [ "$GOT" = "$SIZE" ] || { rm -f "$TARGET.part"; die "Het gedownloade bestand is niet compleet. Er is niets veranderd."; }
  mv "$TARGET.part" "$TARGET"
fi

# ---------- 6. de machine ----------
say "Machine $VMID uitzetten…"
ST=$(qm status "$VMID" 2>/dev/null || true)
if grep -q running <<<"$ST"; then
  qm shutdown "$VMID" --timeout 60 >/dev/null 2>&1 || qm stop "$VMID" >/dev/null 2>&1 || die "Kon machine $VMID niet uitzetten."
fi
qm set "$VMID" --ide2 "$ISOSTORE:iso/$ISO_NAME,media=cdrom" --boot order=ide2 >/dev/null 2>&1 || die "Kon de schijf niet in machine $VMID zetten."
if [ -n "$ADDSTORE" ]; then
  qm set "$VMID" --scsi0 "$ADDSTORE:4" >/dev/null 2>&1 || die "Kon de gegevensschijf niet toevoegen (opslag '$ADDSTORE')."
  say "Gegevensschijf van 4 GB toegevoegd op '$ADDSTORE'."
fi
qm set "$VMID" --agent 1 >/dev/null 2>&1 || true
qm start "$VMID" >/dev/null 2>&1 || die "Kon machine $VMID niet starten."

# ---------- 7. wachten tot de server antwoordt ----------
say "Opstarten… (dit duurt ongeveer een minuut)"
IP=""
for i in $(seq 1 72); do
  sleep 5
  IP=$(qm guest cmd "$VMID" network-get-interfaces 2>/dev/null | python3 -c '
import json, sys
try:
    for n in json.load(sys.stdin):
        for a in n.get("ip-addresses", []):
            if a.get("ip-address-type") == "ipv4" and not a["ip-address"].startswith(("127.", "169.254.")):
                print(a["ip-address"]); raise SystemExit
except Exception:
    pass' 2>/dev/null || true)
  [ -n "$IP" ] && wget -qO- --timeout=4 "http://$IP:8080/healthz" >/dev/null 2>&1 && break
  IP=""
done
if [ -z "$IP" ]; then
  say "De machine is gestart, maar ik zie het adres of de server nog niet. Wacht nog een minuut en kijk in Proxmox bij de console van machine $VMID, of probeer http://saga-deur.local:8080/admin"
  exit 0
fi
VER=$(wget -qO- --timeout=4 "http://$IP:8080/api/auth-info" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' 2>/dev/null || true)
say ""
say "✓ Klaar. Je server draait${VER:+ versie $VER}."
say "  Paneel:  http://$IP:8080/admin   (of http://saga-deur.local:8080/admin)"
[ -n "$ADDSTORE" ] && say "  De gegevensschijf is nieuw en leeg: zet je back-up terug (Instellingen → Meer → Back-up terugzetten) of pas docs/saga-aanbevolen-instellingen.json toe."
say "  Een volgende keer werk je bij met de knop in het paneel: Systeem → Server bijwerken."
