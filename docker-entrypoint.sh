#!/bin/sh
set -eu
PORT="${PORT:-8080}"
sed -i "s/listen 80;/listen ${PORT};/" /etc/nginx/conf.d/default.conf
exec nginx -g "daemon off;"
