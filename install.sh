#!/usr/bin/env bash
set -euo pipefail

# ===== OpenVCS Installer (interactive + CLI flags) =====
# - No flags: show a dialog (Stable / Pre-release / Uninstall)
# - --prerelease: install latest pre-release
# - --uninstall : uninstall
# - Safe atomic install; no rm -f/-rf
# =======================================================

# --- Config ---
REPO_OWNER="Jordonbc"
REPO_NAME="OpenVCS"

INSTALL_DIR="${HOME}/Applications"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_NAME="openvcs"
ICON_SOURCE_PATH="docs/images/logos/OpenVCS-256.png"
ICON_URL_BRANCH="Dev"
ICON_THEME_DIR="${HOME}/.local/share/icons/hicolor"
ICON_TARGET_DIR="${ICON_THEME_DIR}/256x256/apps"
ICON_PATH="${ICON_TARGET_DIR}/${ICON_NAME}.png"

APP_VARIANT="stable"
APP_DISPLAY_NAME="OpenVCS"
TARGET_BASENAME="openvcs.AppImage"
DESKTOP_BASENAME="openvcs.desktop"
TARGET_PATH="${INSTALL_DIR%/}/${TARGET_BASENAME}"
DESKTOP_PATH="${DESKTOP_DIR}/${DESKTOP_BASENAME}"

# --- State ---
INCLUDE_PRERELEASE=false
UNINSTALL=false
INTERACTIVE_MODE=false
DIALOG_TOOL="none"

# --- Helpers: dialogs ---
detect_dialog_tool() {
  if command -v kdialog >/dev/null 2>&1; then
    DIALOG_TOOL="kdialog"
  elif command -v zenity >/dev/null 2>&1; then
    DIALOG_TOOL="zenity"
  elif command -v whiptail >/dev/null 2>&1; then
    DIALOG_TOOL="whiptail"
  elif command -v dialog >/dev/null 2>&1; then
    DIALOG_TOOL="dialog"
  else
    DIALOG_TOOL="none"
  fi
}

show_info() { # $1: message
  case "$DIALOG_TOOL" in
    kdialog)  kdialog --msgbox "$1" 2>/dev/null || true ;;
    zenity)   zenity --info --title="OpenVCS Installer" --text="$1" 2>/dev/null || true ;;
    whiptail) whiptail --title "OpenVCS Installer" --msgbox "$1" 10 70 || true ;;
    dialog)   dialog --title "OpenVCS Installer" --msgbox "$1" 10 70 || true; clear ;;
    *)        printf '\n%s\n' "$1" ;;
  esac
}

show_error() { # $1: message
  case "$DIALOG_TOOL" in
    kdialog)  kdialog --error "$1" 2>/dev/null || true ;;
    zenity)   zenity --error --title="OpenVCS Installer" --text="$1" 2>/dev/null || true ;;
    whiptail) whiptail --title "OpenVCS Installer" --msgbox "❌ $1" 10 70 || true ;;
    dialog)   dialog --title "OpenVCS Installer" --msgbox "❌ $1" 10 70 || true; clear ;;
    *)        printf '\n❌ %s\n' "$1" >&2 ;;
  esac
}

install_icon() {
  [[ -z "${ICON_DOWNLOAD_URL:-}" ]] && return 1
  echo "Installing icon to ${ICON_PATH}..."
  mkdir -p "${ICON_TARGET_DIR}"
  local tmp_icon
  tmp_icon="$(mktemp)" || return 1
  if ! curl -fsSL "${ICON_DOWNLOAD_URL}" -o "${tmp_icon}"; then
    rm -f "${tmp_icon}"
    return 1
  fi
  install -m 0644 "${tmp_icon}" "${ICON_PATH}" || {
    rm -f "${tmp_icon}"
    return 1
  }
  rm -f "${tmp_icon}"
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q "${ICON_THEME_DIR}" >/dev/null 2>&1 || true
  fi
  return 0
}

refresh_desktop_entries() {
  sleep 2
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${DESKTOP_DIR}" >/dev/null 2>&1 || true
  fi
  if command -v xdg-desktop-menu >/dev/null 2>&1; then
    xdg-desktop-menu forceupdate >/dev/null 2>&1 || true
  fi
  if command -v kbuildsycoca6 >/dev/null 2>&1; then
    kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
  elif command -v kbuildsycoca5 >/dev/null 2>&1; then
    kbuildsycoca5 --noincremental >/dev/null 2>&1 || true
  elif command -v kbuildsycoca4 >/dev/null 2>&1; then
    kbuildsycoca4 >/dev/null 2>&1 || true
  fi
}

set_install_variant() { # $1: stable|beta|nightly|prerelease
  case "$1" in
    beta)
      APP_VARIANT="beta"
      APP_DISPLAY_NAME="OpenVCS Beta"
      TARGET_BASENAME="openvcs-beta.AppImage"
      DESKTOP_BASENAME="openvcs-beta.desktop"
      ;;
    nightly)
      APP_VARIANT="nightly"
      APP_DISPLAY_NAME="OpenVCS Nightly"
      TARGET_BASENAME="openvcs-nightly.AppImage"
      DESKTOP_BASENAME="openvcs-nightly.desktop"
      ;;
    prerelease)
      APP_VARIANT="prerelease"
      APP_DISPLAY_NAME="OpenVCS Pre-release"
      TARGET_BASENAME="openvcs-prerelease.AppImage"
      DESKTOP_BASENAME="openvcs-prerelease.desktop"
      ;;
    *)
      APP_VARIANT="stable"
      APP_DISPLAY_NAME="OpenVCS"
      TARGET_BASENAME="openvcs.AppImage"
      DESKTOP_BASENAME="openvcs.desktop"
      ;;
  esac

  TARGET_PATH="${INSTALL_DIR%/}/${TARGET_BASENAME}"
  DESKTOP_PATH="${DESKTOP_DIR}/${DESKTOP_BASENAME}"
}

detect_release_variant() { # $1: release tag, $2: asset name
  local combined
  combined="${1,,} ${2,,}"

  case "$combined" in
    *nightly*) printf 'nightly' ;;
    *beta*) printf 'beta' ;;
    *stable*|*openvcs-v*) printf 'stable' ;;
    *)
      if $INCLUDE_PRERELEASE; then
        printf 'prerelease'
      else
        printf 'stable'
      fi
      ;;
  esac
}

remove_file_if_present() { # $1: path, $2: label
  if [[ -f "$1" ]]; then
    echo "Removing $2: $1"
    rm "$1"
  else
    echo "No $2 found at $1"
  fi
}

# --- Parse flags ---
for arg in "${@:-}"; do
  case "$arg" in
    --prerelease) INCLUDE_PRERELEASE=true ;;
    --uninstall)  UNINSTALL=true ;;
    --help|-h)
      cat <<EOF
OpenVCS installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/Jordonbc/OpenVCS/Dev/install.sh | bash -s --
  curl ... | bash -s -- --prerelease
  curl ... | bash -s -- --uninstall

No flags -> interactive dialog: stable (default), prerelease, or uninstall.
EOF
      exit 0
      ;;
  esac
done

# --- Interactive mode (no flags) ---
if ! $INCLUDE_PRERELEASE && ! $UNINSTALL && [[ "$#" -eq 0 ]]; then
  detect_dialog_tool
  INTERACTIVE_MODE=true

  cancel_exit() { echo "Cancelled by user."; exit 0; }

  CHOICE=""
  RC=0
  case "$DIALOG_TOOL" in
    kdialog)
      CHOICE="$(kdialog --menu "OpenVCS installer: choose action" \
        stable "Install latest stable" \
        prerelease "Install latest pre-release" \
        uninstall "Uninstall OpenVCS")" || RC=$?
      (( RC != 0 )) && cancel_exit
      ;;
    zenity)
      CHOICE="$(zenity --list --title="OpenVCS Installer" \
        --text="Choose action" --radiolist \
        --column="" --column="Option" \
        TRUE "stable" FALSE "prerelease" FALSE "uninstall")" || RC=$?
      (( RC != 0 )) && cancel_exit
      ;;
    whiptail)
      CHOICE="$(whiptail --title "OpenVCS Installer" --radiolist "Choose action" 12 64 3 \
        "stable" "Install latest stable" ON \
        "prerelease" "Install latest pre-release" OFF \
        "uninstall" "Uninstall OpenVCS" OFF 3>&1 1>&2 2>&3)" || RC=$?
      (( RC != 0 )) && cancel_exit
      ;;
    dialog)
      CHOICE="$(dialog --title "OpenVCS Installer" --radiolist "Choose action" 12 64 3 \
        "stable" 1 ON "prerelease" 2 OFF "uninstall" 3 OFF 3>&1 1>&2 2>&3)" || RC=$?
      clear
      (( RC != 0 )) && cancel_exit
      ;;
    none)
      printf '\nOpenVCS installer\n  1) Install stable (default)\n  2) Install pre-release\n  3) Uninstall\nSelect [1-3] (Esc/Ctrl-D to cancel): '
      if ! read -r ans; then
        cancel_exit
      fi
      case "${ans:-1}" in
        2) CHOICE="prerelease" ;;
        3) CHOICE="uninstall" ;;
        *) CHOICE="stable" ;;
      esac
      ;;
  esac

  # Extra guard: empty choice -> cancel
  [[ -z "${CHOICE:-}" ]] && cancel_exit

  case "${CHOICE}" in
    prerelease) INCLUDE_PRERELEASE=true ;;
    uninstall)  UNINSTALL=true ;;
    *)          ;;  # stable default
  esac
fi

# --- Error trap: show GUI error if interactive ---
trap 'if $INTERACTIVE_MODE; then show_error "Installation failed. Check network access or GitHub releases, then try again."; fi' ERR

# --- Uninstall mode ---
if $UNINSTALL; then
  echo "Uninstalling OpenVCS variants..."
  for variant in stable beta nightly prerelease; do
    set_install_variant "$variant"
    remove_file_if_present "${TARGET_PATH}" "${APP_DISPLAY_NAME} AppImage"
    remove_file_if_present "${DESKTOP_PATH}" "${APP_DISPLAY_NAME} desktop entry"
  done

  if [[ -f "${ICON_PATH}" ]]; then
    echo "Removing icon: ${ICON_PATH}"
    rm "${ICON_PATH}"
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
      gtk-update-icon-cache -q "${ICON_THEME_DIR}" >/dev/null 2>&1 || true
    fi
  else
    echo "No icon found at ${ICON_PATH}"
  fi

  refresh_desktop_entries

  echo "✅ OpenVCS variants uninstalled."
  if $INTERACTIVE_MODE; then
    show_info "✅ OpenVCS variants were uninstalled."
  fi
  exit 0
fi

# --- Install mode ---
mkdir -p "${INSTALL_DIR}" "${DESKTOP_DIR}"

# --- Fetch release metadata ---
if $INCLUDE_PRERELEASE; then
  API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=20"
  echo "Fetching ${REPO_NAME} pre-releases..."
  RELEASES_JSON="$(curl -fsSL "${API_URL}")"
else
  API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
  echo "Fetching ${REPO_NAME} latest stable..."
  RELEASES_JSON="$(curl -fsSL "${API_URL}")"
fi

# --- Extract AppImage asset info ---
DOWNLOAD_URL=""
ASSET_NAME=""
RELEASE_TAG=""
ICON_DOWNLOAD_URL=""

if command -v jq >/dev/null 2>&1; then
  if $INCLUDE_PRERELEASE; then
    SEL="$(jq -r '
      ( .[] | select(.draft|not) | select(.prerelease==true) ) as $rel
      | ($rel.assets[] | select(.name|endswith(".AppImage"))
         | [ .browser_download_url, .name, $rel.tag_name ] | @tsv)
    ' <<<"$RELEASES_JSON" | head -n1)"
    ICON_SEL="$(jq -r '
      ( .[] | select(.draft|not) | select(.prerelease==true) ) as $rel
      | ($rel.assets[] | select(.name|test("(?i)icon.*\\.png$"))
         | [ .browser_download_url, .name ] | @tsv)
    ' <<<"$RELEASES_JSON" | head -n1)"
  else
    SEL="$(jq -r '
      . as $rel
      | ($rel.assets[] | select(.name|endswith(".AppImage"))
         | [ .browser_download_url, .name, $rel.tag_name ] | @tsv)
    ' <<<"$RELEASES_JSON" | head -n1)"
    ICON_SEL="$(jq -r '
      . as $rel
      | ($rel.assets[] | select(.name|test("(?i)icon.*\\.png$"))
         | [ .browser_download_url, .name ] | @tsv)
    ' <<<"$RELEASES_JSON" | head -n1)"
  fi
  if [[ -n "${SEL:-}" ]]; then
    IFS=$'\t' read -r DOWNLOAD_URL ASSET_NAME RELEASE_TAG <<<"${SEL}"
  fi
  if [[ -n "${ICON_SEL:-}" ]]; then
    IFS=$'\t' read -r ICON_DOWNLOAD_URL _ <<<"${ICON_SEL}"
  fi
else
  DOWNLOAD_URL="$(printf '%s' "$RELEASES_JSON" \
    | grep -oE '"browser_download_url":[[:space:]]*"[^"]+\.AppImage"' \
    | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  ASSET_NAME="$(basename "${DOWNLOAD_URL:-}")"
  RELEASE_TAG="unknown"
fi

if [[ -z "${ICON_DOWNLOAD_URL}" ]]; then
  ICON_DOWNLOAD_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${ICON_URL_BRANCH}/${ICON_SOURCE_PATH}"
fi

if [[ -z "${DOWNLOAD_URL}" ]]; then
  echo "error: no AppImage asset found in the selected release." >&2
  exit 1
fi

echo "Selected release tag: ${RELEASE_TAG:-unknown}"
$INCLUDE_PRERELEASE && echo "(including pre-releases)"

set_install_variant "$(detect_release_variant "${RELEASE_TAG:-}" "${ASSET_NAME:-}")"
echo "Installing variant: ${APP_DISPLAY_NAME}"

# --- Download safely (atomic on same filesystem) ---
TMP_FILE="$(mktemp --tmpdir="${INSTALL_DIR}" ".openvcs.XXXXXXXX")"
trap '[[ -f "${TMP_FILE:-}" ]] && rm "${TMP_FILE}"' EXIT
echo "Downloading ${ASSET_NAME}..."
curl -fL "${DOWNLOAD_URL}" -o "${TMP_FILE}"

echo "Installing to ${TARGET_PATH}..."
mv "${TMP_FILE}" "${TARGET_PATH}"
trap - EXIT
chmod +x "${TARGET_PATH}"

if ! install_icon; then
  echo "warning: failed to install icon. Desktop entry may lack icon." >&2
fi

# --- Desktop entry ---
echo "Writing desktop entry: ${DESKTOP_PATH}"
cat > "${DESKTOP_PATH}" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_DISPLAY_NAME}
Comment=Cross-platform Git GUI
Exec="${TARGET_PATH}"
Icon=openvcs
Categories=Development;IDE;
Terminal=false
StartupNotify=true
EOF

refresh_desktop_entries

echo
echo "✅ Installed:"
echo "  - ${TARGET_PATH}"
echo "  - Launcher: ${DESKTOP_PATH}"
echo
echo "Launch from your app menu, or run:"
echo "  \"${TARGET_PATH}\""
echo
echo "To uninstall later:"
echo "  $(basename "$0") --uninstall"

# --- Final feedback if interactive ---
if $INTERACTIVE_MODE; then
  show_info "✅ ${APP_DISPLAY_NAME} installed successfully!\n\nLocation:\n${TARGET_PATH}"
fi
