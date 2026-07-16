#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/config"
VERSION="${XIAOMI_HOME_VERSION:-v0.4.7}"
TEMP_DIR="$(mktemp -d /tmp/iothub-xiaomi-home.XXXXXX)"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

mkdir -p "$CONFIG_DIR"
git clone --depth 1 --branch "$VERSION" \
  https://github.com/XiaoMi/ha_xiaomi_home.git "$TEMP_DIR/source"
"$TEMP_DIR/source/install.sh" "$CONFIG_DIR"

echo "Xiaomi Home $VERSION installed. Restart Home Assistant with:"
echo "docker compose -f $SCRIPT_DIR/compose.yaml restart"
