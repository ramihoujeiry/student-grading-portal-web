#!/usr/bin/env python3
"""Add a shared-secret gate to ai_proxy.py (http.server / BaseHTTPRequestHandler style).

Run ON THE PI:
    python3 ai_proxy_shared_secret.py /home/pi/.hermes/ai_proxy.py --secret 'YOUR-SECRET'
    sudo systemctl restart ai-proxy

What it does (safe by design):
  1. Saves a timestamped backup of ai_proxy.py next to it (printed on screen).
  2. Adds a _secret_gate() method to the request Handler class and calls it at
     the top of every do_GET/do_POST/do_PUT/do_DELETE handler.
  3. Requests with header  Authorization: Bearer <YOUR-SECRET>  pass through.
     Everything else gets 401 {"error":"unauthorized"}.
     /healthz stays open so uptime checks keep working.
  4. Byte-compiles the patched file; if the result is broken the backup is
     restored automatically and nothing is left in a bad state.

Re-running is a no-op. To undo manually:
    cp /home/pi/.hermes/ai_proxy.py.bak-<timestamp> /home/pi/.hermes/ai_proxy.py
    sudo systemctl restart ai-proxy
"""
import argparse
import py_compile
import re
import shutil
import sys
import time

SECRET_BLOCK = (
    "# ---- shared secret (added by ai_proxy_shared_secret.py) ----\n"
    "import os as _os\n"
    "_PROXY_SHARED_SECRET = _os.environ.get('PROXY_SHARED_SECRET', %(secret)r)\n"
    "# ---- end shared secret ----\n\n"
)


def gate_method(body_indent: str) -> str:
    lines = [
        "",
        "    # ---- shared-secret gate (added by ai_proxy_shared_secret.py) ----",
        "    def _secret_gate(self):",
        "        \"\"\"True = request may proceed. Otherwise send 401 and return False.\"\"\"",
        "        path = (self.path or '').split('?')[0]",
        "        if path == '/healthz':",
        "            return True  # liveness check stays unauthenticated",
        "        if not _PROXY_SHARED_SECRET:",
        "            return True  # no secret configured -> gate disabled",
        "        if self.headers.get('Authorization', '') == 'Bearer ' + _PROXY_SHARED_SECRET:",
        "            return True",
        "        self.send_response(401)",
        "        self.send_header('Content-Type', 'application/json')",
        "        self.send_header('WWW-Authenticate', 'Bearer realm=\"ai-proxy\"')",
        "        self.end_headers()",
        "        try:",
        "            self.wfile.write(b'{\"error\":\"unauthorized\"}')",
        "        except Exception:",
        "            pass",
        "        return False",
        "    # ---- end shared-secret gate ----",
        "",
    ]
    # normalize the method body to the class's existing body indent
    out = []
    for l in lines:
        out.append((body_indent + l[4:]) if l.startswith('    ') and l[4:5] != ' ' else l)
    return '\n'.join(out) + '\n'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('proxy_path', help='path to ai_proxy.py on the Pi')
    ap.add_argument('--secret', required=True, help='shared secret (same value goes into Firestore config/ai)')
    args = ap.parse_args()

    try:
        with open(args.proxy_path, encoding='utf-8') as f:
            src = f.read()
    except FileNotFoundError:
        print('ERROR: %s not found — check the path.' % args.proxy_path, file=sys.stderr)
        return 1

    if '_secret_gate' in src or '_PROXY_SHARED_SECRET' in src:
        print('Already patched — nothing to do. Restart the proxy to be safe:')
        print('    sudo systemctl restart ai-proxy')
        return 0

    lines = src.splitlines(keepends=True)

    # 1) locate the request Handler class
    class_idx = None
    for i, line in enumerate(lines):
        if re.match(r'^\s*class\s+\w+\(', line) and 'Handler' in line:
            class_idx = i
            break
    if class_idx is None:
        print('ERROR: could not find a "*Handler" class in ai_proxy.py.')
        print('Paste the first 30 lines of ai_proxy.py to your assistant and the patch will be adapted.')
        return 1

    # 2) locate every do_GET/do_POST/... method and the class body indent
    do_defs = []
    body_indent = '    '
    for i in range(class_idx + 1, len(lines)):
        line = lines[i]
        if not line.strip():
            continue
        indent = line[: len(line) - len(line.lstrip())]
        if len(indent) <= len(lines[class_idx]) - len(lines[class_idx].lstrip()):
            break  # left the class body
        if body_indent == '    ' and indent.strip():
            body_indent = indent
        m = re.match(r'^(\s*)def\s+do_\w+\s*\(\s*self\s*\)\s*:', line)
        if m:
            do_defs.append(i)
    if not do_defs:
        print('ERROR: no do_GET/do_POST methods found in the Handler class.')
        print('Paste the first 30 lines of ai_proxy.py to your assistant and the patch will be adapted.')
        return 1

    # 3) build the patched output (backup -> write -> verify -> restore on failure)
    backup = args.proxy_path + '.bak-' + time.strftime('%Y%m%d-%H%M%S')
    shutil.copy2(args.proxy_path, backup)

    out = []
    for i, line in enumerate(lines):
        if i == class_idx:
            out.append(SECRET_BLOCK % {'secret': args.secret})
            out.append(line)
            out.append(gate_method(body_indent))
            continue
        out.append(line)
        if i in do_defs:
            ind = line[: len(line) - len(line.lstrip())]
            out.append(ind + '    if not self._secret_gate(): return\n')

    with open(args.proxy_path, 'w', encoding='utf-8') as f:
        f.write(''.join(out))

    try:
        py_compile.compile(args.proxy_path, doraise=True)
    except Exception as e:
        shutil.copy2(backup, args.proxy_path)
        print('ERROR: patched file did not compile — original restored automatically.')
        print('Detail: %s' % e)
        print('Paste this error to your assistant.')
        return 1

    print('PATCHED OK: %s' % args.proxy_path)
    print('Backup saved as: %s' % backup)
    print('')
    print('Next steps:')
    print('  1. Restart the proxy:      sudo systemctl restart ai-proxy')
    print('     (if that says the service is unknown, reboot:  sudo reboot)')
    print('  2. Check strangers are locked out (should print unauthorized):')
    print('     curl -s -X POST https://raspberrypi.tail3a08db.ts.net/v1/chat/completions')
    print('  3. Check health still works (should print {"ok":true}):')
    print('     curl -s https://raspberrypi.tail3a08db.ts.net/healthz')
    return 0


if __name__ == '__main__':
    sys.exit(main())
