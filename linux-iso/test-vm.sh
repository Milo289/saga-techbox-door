#!/usr/bin/env bash
# Probeert de Linux-schijf (ISO) uit in een virtuele computer op je eigen computer. Je hebt geen tweede computer of usb-stick nodig.
#   ./linux-iso/test-vm.sh [bestand.iso]
# Daarna: het deurscherm verschijnt in het venster; het bedieningspaneel staat op http://localhost:8080/admin op je eigen computer.
# Nodig: QEMU  (Mac: brew install qemu   ·   Debian/Ubuntu: sudo apt install qemu-system-x86 qemu-system-arm qemu-efi-aarch64)
set -euo pipefail
ISO="${1:-$(ls Saga-Techbox-Deur-OS-*.iso 2>/dev/null | head -1)}"
[ -f "$ISO" ] || { echo "Geef het ISO-bestand mee: ./linux-iso/test-vm.sh Saga-Techbox-Deur-OS-amd64.iso"; exit 1; }
command -v qemu-system-x86_64 >/dev/null || { echo "QEMU ontbreekt. Mac: brew install qemu"; exit 1; }
PORT="${PORT:-8080}"; MEM="${MEM:-2048}"
case "$ISO" in
  *arm64*)
    FW=""; for f in /opt/homebrew/share/qemu/edk2-aarch64-code.fd /usr/local/share/qemu/edk2-aarch64-code.fd /usr/share/AAVMF/AAVMF_CODE.fd /usr/share/qemu-efi-aarch64/QEMU_EFI.fd; do [ -f "$f" ] && FW="$f" && break; done
    [ -n "$FW" ] || { echo "Geen UEFI-bestand voor ARM gevonden (installeer qemu-efi-aarch64)."; exit 1; }
    ACCEL=tcg; [ "$(uname -m)" = arm64 -o "$(uname -m)" = aarch64 ] && { [ "$(uname)" = Darwin ] && ACCEL=hvf || ACCEL=kvm; }
    CPU=max; [ "$ACCEL" != tcg ] && CPU=host
    exec qemu-system-aarch64 -M virt -accel "$ACCEL" -cpu "$CPU" -m "$MEM" -smp 2 -bios "$FW" \
      -device virtio-gpu-pci -device qemu-xhci -device usb-kbd -device usb-mouse \
      -drive file="$ISO",media=cdrom,if=none,id=cd -device usb-storage,drive=cd,bootindex=0 \
      -nic user,hostfwd=tcp::"$PORT"-:8080 ;;
  *)
    ACCEL=tcg; [ "$(uname)" = Darwin ] && [ "$(uname -m)" = x86_64 ] && ACCEL=hvf; [ -w /dev/kvm ] 2>/dev/null && ACCEL=kvm
    exec qemu-system-x86_64 -accel "$ACCEL" -m "$MEM" -smp 2 -cdrom "$ISO" -boot d -vga virtio \
      -nic user,hostfwd=tcp::"$PORT"-:8080 ;;
esac
