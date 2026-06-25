#!/bin/sh
set -eu

APP_DESKTOP_FILE="/usr/share/applications/${executable}.desktop"
SHORTCUT_NAME="${productFilename}.desktop"

copy_shortcut_to_desktop() {
  home_dir="$1"
  desktop_dir="$2"

  if [ ! -d "$desktop_dir" ] || [ ! -f "$APP_DESKTOP_FILE" ]; then
    return 0
  fi

  shortcut_path="$desktop_dir/$SHORTCUT_NAME"
  cp "$APP_DESKTOP_FILE" "$shortcut_path"
  chmod 755 "$shortcut_path"

  if command -v stat >/dev/null 2>&1; then
    owner="$(stat -c '%u:%g' "$home_dir" 2>/dev/null || true)"
    if [ -n "$owner" ]; then
      chown "$owner" "$shortcut_path" 2>/dev/null || true
    fi
  fi
}

resolve_xdg_desktop_dir() {
  home_dir="$1"
  user_dirs_file="$home_dir/.config/user-dirs.dirs"

  if [ ! -f "$user_dirs_file" ]; then
    return 0
  fi

  desktop_entry="$(grep '^XDG_DESKTOP_DIR=' "$user_dirs_file" 2>/dev/null | tail -n 1 || true)"
  if [ -z "$desktop_entry" ]; then
    return 0
  fi

  desktop_dir="$(printf '%s' "$desktop_entry" \
    | sed 's/^XDG_DESKTOP_DIR=//' \
    | sed 's/^"//' \
    | sed 's/"$//' \
    | sed "s|\$HOME|$home_dir|g")"

  if [ -n "$desktop_dir" ]; then
    printf '%s\n' "$desktop_dir"
  fi
}

install_for_home() {
  home_dir="$1"

  if [ ! -d "$home_dir" ]; then
    return 0
  fi

  xdg_desktop_dir="$(resolve_xdg_desktop_dir "$home_dir" || true)"
  if [ -n "$xdg_desktop_dir" ]; then
    copy_shortcut_to_desktop "$home_dir" "$xdg_desktop_dir"
  fi

  copy_shortcut_to_desktop "$home_dir" "$home_dir/Desktop"
  copy_shortcut_to_desktop "$home_dir" "$home_dir/桌面"
}

install_for_home "/root"

for home_dir in /home/*; do
  [ -d "$home_dir" ] || continue
  install_for_home "$home_dir"
done

exit 0
