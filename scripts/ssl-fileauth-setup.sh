#!/usr/bin/env bash
#
# 腾讯云 / TrustAsia 免费证书「文件验证」落盘 + 自检脚本
#
# 背景：免费 DV 证书每 90 天到期，续签时要重新做域名控制权验证（DCV）。
#       选「文件验证」时，CA 会来抓 http(s)://<域名>/.well-known/pki-validation/fileauth.txt
#       必须**原样返回验证串**，返回 301、或返回 SPA 的 index.html 都会一直卡在「验证中」。
#
# 用法（在域名的**入口 nginx 机器**上执行，本项目通常是 122.51.58.187）：
#   sudo bash ssl-fileauth-setup.sh <fileauth.txt 内容> [web根目录]
#   sudo bash ssl-fileauth-setup.sh --check
#
# 只看不改：加 --dry-run
#
set -euo pipefail

DOMAIN_PRIMARY="llmpingce.com"
DOMAIN_WWW="www.llmpingce.com"
DCV_PATH="/.well-known/pki-validation/fileauth.txt"

TOKEN=""
WEB_ROOT=""
DRY_RUN=0
CHECK_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --*) echo "未知参数: $arg" >&2; exit 2 ;;
    *) if [ -z "$TOKEN" ]; then TOKEN="$arg"; else WEB_ROOT="$arg"; fi ;;
  esac
done

# ---------- 找 web 根目录 ----------
detect_root() {
  local found
  found="$(nginx -T 2>/dev/null | awk '/^[[:space:]]*root[[:space:]]/{print $2; exit}' | tr -d ';')"
  if [ -n "$found" ]; then echo "$found"; else echo "/var/www/llmpingce"; fi
}

if [ -z "$WEB_ROOT" ]; then
  if [ "$CHECK_ONLY" -eq 1 ]; then
    WEB_ROOT="$(detect_root)"
  else
    WEB_ROOT="$(detect_root)"
  fi
fi

TARGET_DIR="${WEB_ROOT}/.well-known/pki-validation"
TARGET_FILE="${TARGET_DIR}/fileauth.txt"

echo "== 配置 =="
echo "  域名       : ${DOMAIN_PRIMARY} , ${DOMAIN_WWW}"
echo "  web 根目录 : ${WEB_ROOT}"
echo "  验证文件   : ${TARGET_FILE}"

# ---------- 自检 ----------
self_check() {
  local host code body ok=1
  for host in "$DOMAIN_PRIMARY" "$DOMAIN_WWW"; do
    for scheme in http https; do
      local curl_args=(-s -o /tmp/.dcv_body -m 10 -w '%{http_code}' -H "Host: ${host}")
      [ "$scheme" = "https" ] && curl_args+=(-k)
      code="$(curl "${curl_args[@]}" "${scheme}://127.0.0.1${DCV_PATH}" 2>/dev/null || echo 000)"
      body="$(head -c 200 /tmp/.dcv_body 2>/dev/null | tr -d '\r\n')"
      if [ "$code" = "200" ] && [ "$body" = "$TOKEN" ]; then
        echo "  [OK]   ${scheme}://${host}${DCV_PATH}  -> 200，内容匹配"
      else
        ok=0
        local hint=""
        if [ "$code" = "301" ] || [ "$code" = "302" ]; then
          hint="（被跳转吞掉了，需要 location ^~ /.well-known/ 抢在前面）"
        elif [ "$code" = "200" ] && [ "$body" != "$TOKEN" ]; then
          hint="（返回的不是验证串，是 SPA 兜底到 index.html 了）"
        fi
        echo "  [FAIL] ${scheme}://${host}${DCV_PATH}  -> ${code} ${hint}"
        echo "         实际内容前 80 字节: $(printf '%s' "$body" | head -c 80)"
      fi
    done
  done
  rm -f /tmp/.dcv_body
  return $((1 - ok))
}

usage_snippet() {
  cat <<EOF

-- 需要在入口 nginx 里加下面这段（两个 server 块都要加：80 和 443）--

  # 必须用 ^~ 前缀匹配：它优先于 location / 的 try_files 兜底，
  # 也优先于任何正则 location；放在 80 端口块里还能抢在 return 301 之前命中。
  location ^~ /.well-known/pki-validation/ {
      root ${WEB_ROOT};
      default_type text/plain;
      try_files \$uri =404;
      allow all;
      access_log off;
  }

-- 如果 80 端口块用的是「server 级」的 return 301（不是写在 location 里）--
-- 那么 location 永远不会被执行，必须改成下面这种写法：         --

  server {
      listen 80;
      server_name ${DOMAIN_PRIMARY} ${DOMAIN_WWW};

      location ^~ /.well-known/pki-validation/ {   # 先放行验证文件
          root ${WEB_ROOT};
          default_type text/plain;
          try_files \$uri =404;
      }

      location / {                                  # 其余的才跳 https
          return 301 https://\$host\$request_uri;
      }
  }

-- 改完执行 --
  nginx -t && systemctl reload nginx

EOF
}

# ---------- 只检查 ----------
if [ "$CHECK_ONLY" -eq 1 ]; then
  if [ ! -f "$TARGET_FILE" ]; then
    echo "验证文件不存在: ${TARGET_FILE}" >&2
    exit 1
  fi
  TOKEN="$(tr -d '\r\n' < "$TARGET_FILE")"
  echo "== 自检 =="
  self_check || true
  exit 0
fi

if [ -z "$TOKEN" ]; then
  echo "用法: sudo bash $0 <fileauth.txt 内容> [web根目录]" >&2
  echo "      sudo bash $0 --check" >&2
  exit 2
fi

echo "  验证串     : ${TOKEN}"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "== dry-run，不写文件 =="
  usage_snippet
  exit 0
fi

# ---------- 落盘 ----------
mkdir -p "$TARGET_DIR"
printf '%s' "$TOKEN" > "$TARGET_FILE"
chmod 644 "$TARGET_FILE"
# 逐级放开读权限，避免中间目录 0700 导致 nginx(www-data) 读不到
chmod o+rx "${WEB_ROOT}" "${WEB_ROOT}/.well-known" "$TARGET_DIR" 2>/dev/null || true

echo "== 已写入 =="
ls -l "$TARGET_FILE"
echo "  内容: $(cat "$TARGET_FILE")"

echo
echo "== 自检 =="
if self_check; then
  echo "全部通过。回腾讯云控制台点「验证域名」即可。"
else
  echo "有路径未通过，按下面片段调整 nginx 后重新执行 --check。"
  usage_snippet
fi
