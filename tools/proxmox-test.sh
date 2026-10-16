#!/usr/bin/env bash
# Tries the Saga Techbox Deur OS disc on a Proxmox server: makes a throw-away virtual machine, starts the disc, waits until the
# door server answers, checks the panel, the page and that the closed ports stay closed, and prints a short report.
# Run it ON the Proxmox host (as root):   ./proxmox-test.sh Saga-Techbox-Deur-OS-amd64.iso [--keep] [--vmid 9300] [--bridge vmbr0]
# Only the amd64 disc works on a Proxmox host. Nothing else on the server is touched; the machine is removed afterwards (unless --keep).
set -uo pipefail
ISO=""; KEEP=0; VMID=9300; BRIDGE=vmbr0; ISOSTORE=local
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --vmid) VMID="$2"; shift ;;
    --bridge) BRIDGE="$2"; shift ;;
    --iso-storage) ISOSTORE="$2"; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) ISO="$1" ;;
  esac
  shift
done
[ -n "$ISO" ] && [ -f "$ISO" ] || { echo "Geef het ISO-bestand mee, bijvoorbeeld: $0 Saga-Techbox-Deur-OS-amd64.iso"; exit 2; }
command -v qm >/dev/null || { echo "Dit script moet op de Proxmox-server zelf draaien (het commando 'qm' ontbreekt)."; exit 2; }
if qm status "$VMID" >/dev/null 2>&1; then echo "Er bestaat al een machine met nummer $VMID. Kies een ander nummer met --vmid."; exit 2; fi

pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }
cleanup() { if [ "$KEEP" = 0 ]; then qm stop "$VMID" --skiplock 1 >/dev/null 2>&1; qm destroy "$VMID" --purge 1 >/dev/null 2>&1; echo "De testmachine is weer verwijderd."; else echo "De machine $VMID blijft staan (--keep). Verwijderen: qm stop $VMID; qm destroy $VMID --purge"; fi; }
trap cleanup EXIT

DIR=$(pvesm path "$ISOSTORE:iso/$(basename "$ISO")" 2>/dev/null | xargs -r dirname)
[ -n "$DIR" ] || DIR=/var/lib/vz/template/iso
cp -f "$ISO" "$DIR/" || { echo "Kopiëren naar $DIR lukte niet"; exit 2; }
NAME=$(basename "$ISO")

echo "Machine $VMID maken…"
qm create "$VMID" --name saga-door-test --memory 2048 --cores 2 --ostype l26 --agent 1 --net0 "virtio,bridge=$BRIDGE" \
  --ide2 "$ISOSTORE:iso/$NAME,media=cdrom" --boot order=ide2 --vga std >/dev/null || { echo "Machine maken lukte niet"; exit 2; }
qm start "$VMID" >/dev/null || { echo "Starten lukte niet"; exit 2; }

echo "Wachten tot de machine een adres heeft (maximaal 5 minuten)…"
IP=""
for i in $(seq 1 60); do
  sleep 5
  IP=$(qm guest cmd "$VMID" network-get-interfaces 2>/dev/null | python3 -c '
import json,sys
try:
    for n in json.load(sys.stdin):
        for a in n.get("ip-addresses", []):
            if a.get("ip-address-type") == "ipv4" and not a["ip-address"].startswith(("127.", "169.254.")):
                print(a["ip-address"]); raise SystemExit
except Exception:
    pass
' 2>/dev/null)
  [ -n "$IP" ] && break
done
echo
echo "Verslag"
if [ -z "$IP" ]; then bad "de machine kreeg geen adres (draait de gast-agent? staat de bridge $BRIDGE aan een netwerk met DHCP?)"; echo "  $pass gelukt, $fail mislukt"; exit 1; fi
ok "de machine heeft adres $IP"

up=0
for i in $(seq 1 40); do curl -fsS -m 4 "http://$IP:8080/healthz" >/dev/null 2>&1 && { up=1; break; }; sleep 3; done
[ "$up" = 1 ] && ok "de deurserver antwoordt op http://$IP:8080" || bad "de deurserver antwoordt niet op poort 8080"
if [ "$up" = 1 ]; then
  VER=$(curl -fsS -m 5 "http://$IP:8080/api/auth-info" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' 2>/dev/null)
  [ -n "$VER" ] && ok "versie van de server: $VER" || bad "de server meldt geen versie"
  curl -fsS -m 5 "http://$IP:8080/" | grep -qi "<title" && ok "het deurscherm wordt geleverd" || bad "het deurscherm wordt niet geleverd"
  curl -fsS -m 5 "http://$IP:8080/admin" | grep -qi "<title" && ok "het bedieningspaneel wordt geleverd" || bad "het bedieningspaneel wordt niet geleverd"
  curl -fsS -m 5 -D - -o /dev/null "http://$IP:8080/" | grep -qi "content-security-policy" && ok "de beveiligingskoppen staan erop (CSP)" || bad "de beveiligingskoppen ontbreken"
fi
for port in 22 23 3000 5900; do
  if timeout 3 bash -c "exec 3<>/dev/tcp/$IP/$port" 2>/dev/null; then bad "poort $port staat open (hoort dicht te zijn)"; else ok "poort $port is dicht"; fi
done
echo
echo "  $pass gelukt, $fail mislukt"
echo "Bedieningspaneel om zelf te proberen: http://$IP:8080/admin (gebruikersnaam admin; het startwachtwoord staat op het startscherm in de console van de machine)."
[ "$fail" = 0 ]
