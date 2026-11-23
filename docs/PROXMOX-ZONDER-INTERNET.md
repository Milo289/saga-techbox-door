# De Proxmox-server bijwerken zonder internet (via een usb-stick)

Op een computer mét internet:
1. Download `Saga-Techbox-Deur-OS-amd64.iso` van https://github.com/Milo289/saga-techbox-door/releases/latest
2. Download https://raw.githubusercontent.com/Milo289/saga-techbox-door/main/tools/proxmox-update.sh
3. Zet beide bestanden op een usb-stick (de ISO is ongeveer 620 MB; elk gewoon formaat werkt).

Op de Proxmox-computer (Shell, als root):
```
lsblk                                   # zoek de stick, bijvoorbeeld sdb1
mkdir -p /mnt/usb && mount /dev/sdb1 /mnt/usb
bash /mnt/usb/proxmox-update.sh --usb --ja
```
Het script zoekt de ISO zelf op de stick, kopieert hem naar de ISO-opslag, zet hem in het dvd-station van je Saga-machine
en start die opnieuw. De gegevensschijf van de machine blijft ongemoeid. Een andere machine? Zet het nummer erbij, bijvoorbeeld `... --usb --ja 107`.
Of geef het bestand zelf: `--bestand /mnt/usb/Saga-Techbox-Deur-OS-amd64.iso`.
Daarna: `umount /mnt/usb` en haal de stick eruit.
