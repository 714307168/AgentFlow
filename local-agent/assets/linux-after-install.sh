#!/bin/sh
set -eu

APP_DESKTOP_FILE="/usr/share/applications/${executable}.desktop"
SHORTCUT_NAME="${productFilename}.desktop"
APP_INSTALL_DIR="/opt/${productFilename}"
APP_ICON_NAME="${executable}"
APP_EXECUTABLE_PATH="$APP_INSTALL_DIR/${executable}"
APP_COMMAND_LINK="/usr/local/bin/${executable}"

fix_chrome_sandbox() {
  sandbox_path="$APP_INSTALL_DIR/chrome-sandbox"

  if [ ! -f "$sandbox_path" ]; then
    return 0
  fi

  chown root:root "$sandbox_path" 2>/dev/null || true
  chmod 4755 "$sandbox_path" 2>/dev/null || true
}

install_command_link() {
  command_dir="$(dirname "$APP_COMMAND_LINK")"

  if [ ! -d "$command_dir" ] || [ ! -x "$APP_EXECUTABLE_PATH" ]; then
    return 0
  fi

  ln -sfn "$APP_EXECUTABLE_PATH" "$APP_COMMAND_LINK" 2>/dev/null || true
}

copy_shortcut_to_desktop() {
  home_dir="$1"
  desktop_dir="$2"

  if [ ! -d "$desktop_dir" ] || [ ! -f "$APP_DESKTOP_FILE" ]; then
    return 0
  fi

  shortcut_path="$desktop_dir/$SHORTCUT_NAME"
  cp "$APP_DESKTOP_FILE" "$shortcut_path"
  chmod 755 "$shortcut_path"

  if command -v gio >/dev/null 2>&1; then
    gio set "$shortcut_path" metadata::trusted true 2>/dev/null || true
  fi

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

fix_chrome_sandbox
install_command_link

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications 2>/dev/null || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
fi

if command -v xdg-icon-resource >/dev/null 2>&1 && [ -f "/usr/share/icons/hicolor/256x256/apps/$APP_ICON_NAME.png" ]; then
  xdg-icon-resource forceupdate 2>/dev/null || true
fi

exit 0
