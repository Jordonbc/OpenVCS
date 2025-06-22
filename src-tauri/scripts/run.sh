#!/usr/bin/env bash
set -euo pipefail

# Disable WebKit’s DMA-BUF path to avoid GBM/Wayland errors
export WEBKIT_DISABLE_DMABUF_RENDERER=1

# (Optional) force Wayland or X11 if you ever need it:
# export GDK_BACKEND=wayland
# export GDK_BACKEND=x11

# Launch your app
exec cargo run "$@"

