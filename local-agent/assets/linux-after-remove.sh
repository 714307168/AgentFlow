#!/bin/sh
set -eu

SHORTCUT_NAME="${productFilename}.desktop"
EXECUTABLE_NAME="${executable}"

remove_shortcut_from_desktop() {
  desktop_dir="$1"
  shortcut_path="$desktop_dir/$SHORTCUT_NAME"

  if [ ! -f "$shortcut_path" ]; then
    return 0
  fi

  if grep -q "Exec=.*$EXECUTABLE_NAME" "$shortcut_path" 2>/dev/null; then
    rm -f "$shortcut_path"
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

remove_for_home() {
  home_dir="$1"

  if [ ! -d "$home_dir" ]; then
    return 0
  fi

  xdg_desktop_dir="$(resolve_xdg_desktop_dir "$home_dir" || true)"
  if [ -n "$xdg_desktop_dir" ]; then
    remove_shortcut_from_desktop "$xdg_desktop_dir"
  fi

  remove_shortcut_from_desktop "$home_dir/Desktop"
  remove_shortcut_from_desktop "$home_dir/桌面"
}

remove_for_home "/root"

for home_dir in /home/*; do
  [ -d "$home_dir" ] || continue
  remove_for_home "$home_dir"
done

exit 0
