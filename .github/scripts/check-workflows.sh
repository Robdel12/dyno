#!/usr/bin/env bash
set -euo pipefail

validator_dir=$(mktemp -d "$RUNNER_TEMP/dyno-actionlint.XXXXXX")
trap 'rm -rf "$validator_dir"' EXIT
archive="$validator_dir/actionlint.tar.gz"
curl --fail --silent --show-error --location \
  https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz \
  -o "$archive"
echo "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8  $archive" | sha256sum --check
tar -xzf "$archive" -C "$validator_dir" actionlint
"$validator_dir/actionlint"
