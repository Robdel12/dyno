#!/usr/bin/env bash
set -euo pipefail

curl --fail --silent --show-error --location https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > "$RUNNER_TEMP/microsoft-edge.gpg"
sudo install -m 644 "$RUNNER_TEMP/microsoft-edge.gpg" /usr/share/keyrings/microsoft-edge.gpg
echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-edge.gpg] https://packages.microsoft.com/repos/edge stable main' | sudo tee /etc/apt/sources.list.d/microsoft-edge.list
sudo apt-get update -o Dir::Etc::sourcelist=sources.list.d/microsoft-edge.list -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
sudo apt-get install --reinstall --no-install-recommends -y microsoft-edge-stable
dpkg-query --show --showformat='${Package} ${Version}\n' microsoft-edge-stable

sudo chown root:root /opt/microsoft/msedge/msedge-sandbox
sudo chmod 4755 /opt/microsoft/msedge/msedge-sandbox
stat --format='%U:%G %a %n' /opt/microsoft/msedge/msedge-sandbox
# The image ships overlapping Edge profiles. Load one explicit userns
# allowance, like Ubuntu's Chrome profile, so Edge keeps its sandbox.
mapfile -t profiles < <(sudo grep -l '/opt/microsoft/msedge/msedge' /etc/apparmor.d/* 2>/dev/null || true)
for profile in "${profiles[@]}"; do
  echo "Replacing Edge attachment: $profile"
  sudo apparmor_parser --remove "$profile"
done
sudo tee /etc/apparmor.d/msedge >/dev/null <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>
profile msedge /opt/microsoft/msedge/msedge flags=(unconfined) {
  userns,
}
PROFILE
sudo apparmor_parser --replace /etc/apparmor.d/msedge
