'use strict';
// remote-control Phase 0 スパイク — LAN の自 IPv4 アドレス取得（依存ゼロ・Node 標準 os のみ）。
// スマホに見せる URL `http://<IP>:<port>` の <IP> はここで決まる（起動している PC が今つながっている
// Wi-Fi の中での住所。ルーターが DHCP で自動割当。同一 LAN 内では重複しない＝ 2 台 PC は別 IP=別 URL）。

const os = require('os');

// internal(127.0.0.1 等) を除いた IPv4 を全部返す。通常は Wi-Fi の 1 件。
function lanIPv4s() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const [iface, addrs] of Object.entries(ifs)) {
    for (const a of (addrs || [])) {
      if (a.family === 'IPv4' && !a.internal) out.push({ iface, address: a.address });
    }
  }
  return out;
}

// 最有力の 1 件（Wi-Fi 優先 → 最初の非 internal）。無ければ null。
function primaryLanIPv4() {
  const all = lanIPv4s();
  const wifi = all.find((x) => /wi-?fi|wlan/i.test(x.iface));
  return (wifi || all[0] || null);
}

module.exports = { lanIPv4s, primaryLanIPv4 };
