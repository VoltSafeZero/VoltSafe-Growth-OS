#!/bin/sh
# Wrapper for playwright's chromium-headless-shell on NixOS.
# Sets LD_LIBRARY_PATH to find the glib/nss/X11 etc. shared libraries
# that the pre-built binary needs but can't find in the NixOS store.
export LD_LIBRARY_PATH="\
/nix/store/c2v6ycn0sjcpx9ww8x7j4ima6xnpssry-glib-2.80.2/lib:\
/nix/store/8a651pfg6s4z27j274baqqb57pp34jkf-nspr-4.35/lib:\
/nix/store/lr06m26d9qh6ssa3x5zx2ll33wm44xid-nss-3.90.2/lib:\
/nix/store/jd41k79l3nxq4b7b7yvc0kmcjd3lq7sa-dbus-1.14.10-lib/lib:\
/nix/store/6rigmq2ycbpgywmq9jjyhdr6vs8k8h8x-at-spi2-core-2.52.0/lib:\
/nix/store/x9fw7rbdb34gq0f8q750kw344lbv9nk1-libX11-1.8.9/lib:\
/nix/store/y16mr4fhn8a8snp5177a6aznq42ci22c-libXcomposite-0.4.6/lib:\
/nix/store/2y8irckx5v4fav7r7p9ghaz7rbwdmfb2-libXdamage-1.1.6/lib:\
/nix/store/gbjygp4wz7b5rgayckmqfc00hy34dqfn-libXext-1.3.6/lib:\
/nix/store/1jjjvxa4v0qqjhlc9ig3j6ljdlskm2kr-libXfixes-6.0.1/lib:\
/nix/store/2rq584mkybbbvm1ciyams5s2lh8cdq32-libXrandr-1.5.4/lib:\
/nix/store/f3bmrmcdxxgxzsh8pgwg49z2zhfs9qfq-mesa-24.0.7/lib:\
/nix/store/18kar5zwp16xyppfmigq92xzm1pkcqf1-libxcb-1.17.0/lib:\
/nix/store/1mv469gq5n0l32cb2lam7mkfl9s22dlg-libxkbcommon-1.7.0/lib:\
/nix/store/0g7r7krqiz6g3nb3651sfa5myd9gqkzf-alsa-lib-1.2.11/lib:\
/nix/store/37bzg32wlrlknwbrsvjr4cxwmjh8dbzl-libXrender-0.9.11/lib:\
/nix/store/y31zz9k1v2gqlzrs7p50llx8db6m2gdr-libdrm-2.4.120/lib:\
/nix/store/0bm4z6dh3v6nnr539xzsak0pn4wccb5l-expat-2.6.2/lib:\
/nix/store/lv6nackqis28gg7l2ic43f6nk52hb39g-zlib-1.3.1/lib:\
/nix/store/kbg5m7fyi1w23fyfmxjhhzcbd577rpg0-libffi-3.4.6/lib:\
/nix/store/8n7i76nx0k6b0zz752lvd3rv8gym39da-libXau-1.0.11/lib:\
/nix/store/iywcnxgdigcjq4skkdpnvqqxqalh3k20-libXxf86vm-1.1.5/lib:\
/nix/store/z14w63wj0gk97hr06l76d4s723ynhr2k-gettext-0.21.1/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

exec /home/runner/workspace/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell "$@"
