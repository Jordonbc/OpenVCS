#!/usr/bin/env bash
set -euo pipefail

# --- Config ---
REPO_OWNER="Jordonbc"
REPO_NAME="OpenVCS"

INSTALL_DIR="${HOME}/Applications"
TARGET_BASENAME="openvcs.AppImage"
TARGET_PATH="${INSTALL_DIR%/}/${TARGET_BASENAME}"

DESKTOP_DIR="${HOME}/.local/share/applications"
DESKTOP_PATH="${DESKTOP_DIR}/openvcs.desktop"

# --- Parse flags ---
INCLUDE_PRERELEASE=false
UNINSTALL=false
for arg in "${@:-}"; do
  case "$arg" in
    --prerelease) INCLUDE_PRERELEASE=true ;;
    --uninstall)  UNINSTALL=true ;;
  esac
done

# --- Uninstall mode ---
if $UNINSTALL; then
  echo "Uninstalling OpenVCS..."
  if [[ -f "${TARGET_PATH}" ]]; then
    echo "Removing AppImage: ${TARGET_PATH}"
    rm "${TARGET_PATH}"
  else
    echo "No AppImage found at ${TARGET_PATH}"
  fi

  if [[ -f "${DESKTOP_PATH}" ]]; then
    echo "Removing desktop entry: ${DESKTOP_PATH}"
    rm "${DESKTOP_PATH}"
  else
    echo "No desktop entry found at ${DESKTOP_PATH}"
  fi

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${DESKTOP_DIR}" >/dev/null 2>&1 || true
  fi

  echo "✅ OpenVCS uninstalled."
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

if command -v jq >/dev/null 2>&1; then
  if $INCLUDE_PRERELEASE; then
    SEL="$(jq -r '
      ( .[] | select(.draft|not) | select(.prerelease==true) ) as $rel
      | ($rel.assets[] | select(.name|endswith(".AppImage"))
         | [ .browser_download_url, .name, $rel.tag_name ] | @tsv)
    ' <<<"$RELEASES_JSON" | head -n1)"
  else
    SEL="$(jq -r '
      . as $rel
      | ($rel.assets[] | select(.name|endswith(".AppImage"))
         | [ .browser_download_url, .name, $rel.tag_name ] | @tsv)
    ' <<<"$RELEASES_JSON" | head -n1)"
  fi
  if [[ -n "$SEL" ]]; then
    IFS=$'\t' read -r DOWNLOAD_URL ASSET_NAME RELEASE_TAG <<<"$SEL"
  fi
else
  DOWNLOAD_URL="$(printf '%s' "$RELEASES_JSON" \
    | grep -oE '"browser_download_url":[[:space:]]*"[^"]+\.AppImage"' \
    | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  ASSET_NAME="$(basename "${DOWNLOAD_URL:-}")"
  RELEASE_TAG="unknown"
fi

if [[ -z "${DOWNLOAD_URL}" ]]; then
  echo "error: no AppImage asset found in the selected release." >&2
  exit 1
fi

echo "Selected release tag: ${RELEASE_TAG:-unknown}"
$INCLUDE_PRERELEASE && echo "(including pre-releases)"

# --- Download safely ---
TMP_FILE="$(mktemp)"
trap '[[ -f "${TMP_FILE}" ]] && rm "${TMP_FILE}"' EXIT
echo "Downloading ${ASSET_NAME}..."
curl -fL "${DOWNLOAD_URL}" -o "${TMP_FILE}"

# Atomic replace: write to temp, then rename over old file
echo "Installing to ${TARGET_PATH}..."
mv "${TMP_FILE}" "${TARGET_PATH}"
trap - EXIT
chmod +x "${TARGET_PATH}"

# --- Desktop entry ---
echo "Writing desktop entry: ${DESKTOP_PATH}"
cat > "${DESKTOP_PATH}" <<EOF
[Desktop Entry]
Type=Application
Name=OpenVCS
Comment=Cross-platform Git GUI
Exec=${TARGET_PATH}
Icon=openvcs
Categories=Development;IDE;
Terminal=false
StartupNotify=true
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${DESKTOP_DIR}" >/dev/null 2>&1 || true
fi

echo
echo "✅ Installed:"
echo "  - ${TARGET_PATH}"
echo "  - Launcher: ${DESKTOP_PATH}"
echo
echo "Run it from your app menu or execute:"
echo "  \"${TARGET_PATH}\""
echo
echo "To uninstall later:"
echo "  $(basename "$0") --uninstall"
