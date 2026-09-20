#!/usr/bin/env python3
"""Generate the shared-secret check for the Pi's ai_proxy.py.

Run on the Pi:
    scp ai_proxy_shared_secret.py pi@raspberrypi:/tmp/
    ssh pi@raspberrypi "python3 /tmp/ai_proxy_shared_secret.py /home/pi/.hermes/ai_proxy.py --secret '<YOUR-SECRET>'"
    ssh pi@raspberrypi "sudo systemctl restart ai-proxy"

What it does to ai_proxy.py (idempotent — safe to re-run):
  1. Defines `_SHARED_SECRET` read from the environment (PROXY_SHARED_SECRET)
     or the --secret value baked in, so the secret never needs to live in git.
  2. Inserts a check right after the request handler resolves: any request
     whose Authorization header is not exactly `Bearer <secret>` gets 401.
     /healthz is exempt so you can still check liveness unauthenticated.
"""
import argparse
import sys

CHECK_SNIPPET = '''
# ---- shared-secret gate (added by ai_proxy_shared_secret.py) ----
# Reject any request without the exact shared secret. /healthz stays open so
# uptime checks keep working; the browser app sends the secret automatically.
import os as _os
_SHARED_SECRET = _os.environ.get('PROXY_SHARED_SECRET', '%(secret)s')
if _SHARED_SECRET:
    _auth = self.headers.get('Authorization', '')
    if self.path.startswith('/healthz'):
        pass  # liveness check stays unauthenticated
    elif _auth != 'Bearer ' + _SHARED_SECRET:
        self.send_response(401)
        self.send_header('Content-Type', 'application/json')
        self.send_header('WWW-Authenticate', 'Bearer realm="ai-proxy"')
        self.end_headers()
        self.wfile.write(b'{"error":"unauthorized"}')
        return
# ---- end shared-secret gate ----
'''

MARKER = '---- shared-secret gate'

# Heuristic insertion points, tried in order — ai_proxy.py is a plain
# http.server / BaseHTTPRequestHandler-style file (per SESSION_CHECKPOINT.md).
ANCHORS = [
    ('def do_POST', 'after'),
    ('do_POST', 'after'),
    ('class .*Handler', 'after-class'),
]

def find_insertion(src: str):
    for anchor, kind in ANCHORS:
        for line in src.splitlines():
            stripped = line.strip()
            if anchor.startswith('def ') and stripped.startswith(anchor) or stripped.startswith(anchor):
                indent = line[:len(line) - len(line.lstrip())]
                if kind == 'after-class':
                    return None  # handled by caller fallback
                return indent + ' ' * 4
    return None

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('proxy_path', help='path to ai_proxy.py on the Pi')
    ap.add_argument('--secret', required=True, help='shared secret value to bake in (also settable via PROXY_SHARED_SECRET env)')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    try:
        src = open(args.proxy_path, encoding='utf-8').read()
    except FileNotFoundError:
        print(f'ERROR: {args.proxy_path} not found', file=sys.stderr)
        return 1

    if MARKER in src:
        print('ai_proxy.py already contains the shared-secret gate — nothing to do.')
        return 0

    # Insert at the top of the class body (right after the first "class ...(BaseHTTPRequestHandler)" line)
    lines = src.splitlines(keepends=True)
    insert_at = None
    for i, line in enumerate(lines):
        if line.lstrip().startswith('class ') and 'Handler' in line:
            insert_at = i + 1
            break
    if insert_at is None:
        print('ERROR: could not find a Handler class in ai_proxy.py — patch manually (see CHECK_SNIPPET).', file=sys.stderr)
        return 1

    # Determine indentation of the class body: first indented line after the class, else 4 spaces.
    body_indent = '    '
    for line in lines[insert_at:insert_at + 20]:
        if line.strip() and (line.startswith(' ') or line.startswith('\t')):
            body_indent = line[:len(line) - len(line.lstrip())]
            break

    snippet = CHECK_SNIPPET % {'secret': args.secret}
    indented = '\n'.join((body_indent + l) if l.strip() else l for l in snippet.strip('\n').split('\n')) + '\n\n'
    lines.insert(insert_at, indented)
    out = ''.join(lines)

    if args.dry_run:
        print(out)
        return 0

    with open(args.proxy_path, 'w', encoding='utf-8') as f:
        f.write(out)
    print(f'Patched {args.proxy_path}: shared-secret gate installed (secret baked in; PROXY_SHARED_SECRET env overrides).')
    print('Restart the proxy so it takes effect:  sudo systemctl restart ai-proxy   (or relaunch ai_proxy.py)')
    print('Then set the SAME secret in the web app: Firestore config/ai { enabled:true, endpoint:..., apiKey:"<secret>" }')
    return 0

if __name__ == '__main__':
    sys.exit(main())
