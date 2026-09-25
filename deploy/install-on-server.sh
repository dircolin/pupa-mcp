#!/bin/bash
# 서버(125.131.175.21)에서 실행: /home/pupa/pupa-mcp 설치·기동 + nginx 에 /mcp 경로 추가. pupa-proxy 는 손대지 않는다.
set -eu
cd /home/pupa/pupa-mcp
npm install --omit=dev --no-audit --no-fund
mkdir -p data && chmod 700 data
sudo -n cp deploy/pupa-mcp.service /etc/systemd/system/pupa-mcp.service
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now pupa-mcp
sleep 1; systemctl is-active pupa-mcp; curl -s http://127.0.0.1:8790/mcp/health; echo
NG=/etc/nginx/sites-available/pupa-proxy
if ! grep -q "PUPA MCP" "$NG"; then
  sudo -n cp "$NG" "$NG.bak-mcp-$(date +%Y%m%d%H%M%S)"
  # server 블록의 마지막 '}' 앞에 location 들을 끼운다
  sudo -n python3 - "$NG" <<'PY'
import sys,re
p=sys.argv[1]; s=open(p).read(); add=open('/home/pupa/pupa-mcp/deploy/nginx-mcp-locations.conf').read()
i=s.rstrip().rfind('}')
s=s[:i]+add+s[i:]
open(p,'w').write(s)
PY
  sudo -n nginx -t && sudo -n systemctl reload nginx
fi
echo "== public"; curl -s -o /dev/null -w "%{http_code}\n" https://proxy.pupastage.com/mcp/health; curl -s https://proxy.pupastage.com/.well-known/oauth-authorization-server/mcp | head -c 300; echo
