#!/usr/bin/env bash
# Packs a backup folder into ONE encrypted file, or opens one again.
#   encrypt.sh pack   <folder> <file.tar.enc>     (passphrase in $BACKUP_PASSPHRASE)
#   encrypt.sh unpack <file.tar.enc> <folder>
# AES-256, key from the passphrase (PBKDF2, 600000 rounds). Without the
# passphrase the file is unreadable, so keep it in a password manager.
set -euo pipefail
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
case "$1" in
  pack)
    tar -C "$2" -cf - . | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -out "$3"
    ;;
  unpack)
    mkdir -p "$3"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in "$2" | tar -C "$3" -xf -
    ;;
  *) echo "usage: encrypt.sh pack|unpack ..." >&2; exit 2 ;;
esac
