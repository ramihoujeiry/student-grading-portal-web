#!/usr/bin/env python3
"""Add a shared-secret gate to ai_proxy.py (http.server / BaseHTTPRequestHandler style)
AND make it browser-CORS-friendly.

Run ON THE PI (safe to re-run — it upgrades any previous version of the patch):
    python3 ai_proxy_shared_secret.py /home/pi/.hermes/ai_proxy.py              # generates a strong secret
    python3 ai_proxy_shared_secret.py /home/pi/.hermes/ai_proxy.py --secret '<long random value>'
    sudo systemctl restart ai-proxy   # or relaunch the nohup process, see "Next" below

The secret set here must be EXACTLY the same value as Firestore config/ai -> apiKey.
Obvious placeholders (PASTE-YOUR-SECRET, THE-SECRET-FROM-FIRESTORE, ...) and short
secrets (<16 chars) are REJECTED so they can never end up guarding the gate.

What it does:
  1. Backs up ai_proxy.py (timestamped .bak-<date>) next to it.
  2. Adds/UPGRADES a _secret_gate() method on the request Handler class and calls
     it at the top of every do_GET/do_POST/do_PUT/do_DELETE handler.
       - Requests with header  Authorization: Bearer <YOUR-SECRET>  pass through.
       - Everything else gets 401 {"error":"unauthorized"} WITH CORS headers so
         the browser shows the real status instead of an opaque "Failed to fetch".
       - /healthz stays open; no secret configured = gate disabled.
  3. Adds "Authorization" to every Access-Control-Allow-Headers response header
     (browsers refuse requests carrying Authorization unless it is listed there).
  4. Adds a do_OPTIONS preflight handler only if the file has none.
  5. Byte-compiles the result; on failure the backup is restored automatically.

Re-running with a different --secret replaces the old secret (fixes typos).
Manual undo:
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

GATE_START = "# ---- shared-secret gate (added by ai_proxy_shared_secret.py) ----"
GATE_END = "# ---- end shared-secret gate ----"


def gate_method(indent: str) -> str:
    body = [
        GATE_START,
        "def _secret_gate(self):",
        '    """True = proceed. Otherwise send a CORS-friendly 401 and return False."""',
        "    path = (self.path or '').split('?')[0]",
        "    if path == '/healthz':",
        "        return True  # liveness probe stays unauthenticated",
        "    if (self.command or '').upper() == 'OPTIONS':",
        "        return True  # CORS preflights never carry Authorization - never gate them",
        "    if not _PROXY_SHARED_SECRET:",
        "        return True  # no secret configured -> gate disabled",
        "    if self.headers.get('Authorization', '') == 'Bearer ' + _PROXY_SHARED_SECRET:",
        "        return True",
        "    origin = self.headers.get('Origin', '*')",
        "    self.send_response(401)",
        "    self.send_header('Content-Type', 'application/json')",
        "    self.send_header('Access-Control-Allow-Origin', origin)",
        "    self.send_header('WWW-Authenticate', 'Bearer realm=\"ai-proxy\"')",
        "    self.end_headers()",
        "    try:",
        "        self.wfile.write(b'{\"error\":\"unauthorized\"}')",
        "    except Exception:",
        "        pass",
        "    return False",
        GATE_END,
    ]
    return '\n'.join((indent + l) if l else l for l in body) + '\n\n'


def options_method(indent: str) -> str:
    body = [
        "# ---- CORS preflight (added by ai_proxy_shared_secret.py) ----",
        "def do_OPTIONS(self):",
        "    origin = self.headers.get('Origin', '*')",
        "    self.send_response(204)",
        "    self.send_header('Access-Control-Allow-Origin', origin)",
        "    self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')",
        "    self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')",
        "    self.send_header('Access-Control-Max-Age', '86400')",
        "    self.end_headers()",
        "# ---- end CORS preflight ----",
    ]
    return '\n'.join((indent + l) if l else l for l in body) + '\n\n'


def strip_previous_patch(src: str):
    """Remove v1/v2 patch blocks so the fresh patch can be applied cleanly."""
    src = re.sub(
        r"# ---- shared secret \(added by ai_proxy_shared_secret\.py\) ----.*?# ---- end shared secret ----\n\n?",
        "", src, flags=re.S)
    src = re.sub(
        r"[ \t]*# ---- shared-secret gate \(added by ai_proxy_shared_secret\.py\) ----.*?[ \t]*# ---- end shared-secret gate ----\n",
        "", src, flags=re.S)
    src = re.sub(r"^[ \t]*if not self\._secret_gate\(\): return\n", "", src, flags=re.M)
    src = re.sub(
        r"[ \t]*# ---- CORS preflight \(added by ai_proxy_shared_secret\.py\) ----.*?[ \t]*# ---- end CORS preflight ----\n\n?",
        "", src, flags=re.S)
    return src


def fix_allow_headers(src: str):
    """Ensure every Access-Control-Allow-Headers value lists Authorization."""
    pattern = re.compile(r"(Access-Control-Allow-Headers\b['\"]?\s*[,:]\s*['\"])([^'\"]*)(['\"])")
    count = 0

    def repl(m):
        nonlocal count
        val = m.group(2)
        if 'authorization' in val.lower():
            return m.group(0)
        count += 1
        add = (', Authorization' if val.strip() else 'Authorization')
        return m.group(1) + val + add + m.group(3)

    return pattern.sub(repl, src), count


PLACEHOLDER_HINTS = (
    'PASTE', 'YOUR-', 'REPLACE', 'PLACEHOLDER', 'EXAMPLE',
    'FROM-FIRESTORE', 'CHANGE-ME', 'CHANGEME', 'TODO',
)


def looks_like_placeholder(secret: str) -> bool:
    u = secret.strip().upper()
    return any(h in u for h in PLACEHOLDER_HINTS)


def generate_secret() -> str:
    import secrets
    return secrets.token_hex(24)  # 48 hex chars, ~192 bits


def main() -> int:
    ap = argparse.ArgumentParser(
        description='Gate ai_proxy.py behind a shared secret (run ON THE PI).')
    ap.add_argument('proxy_path', help='path to ai_proxy.py on the Pi')
    ap.add_argument('--secret', default=None,
                    help='shared secret; OMIT it and a strong one is generated and printed for you '
                         '(same value goes into Firestore config/ai apiKey)')
    ap.add_argument('--generate', action='store_true',
                    help='generate a strong secret even if --secret was also given')
    args = ap.parse_args()

    if args.generate:
        if args.secret:
            print('ERROR: pass either --secret or --generate, not both.')
            return 2
        secret = generate_secret()
        print('=' * 64)
        print('GENERATED SECRET — copy this line now, you need it in step 3:')
        print('')
        print('    %s' % secret)
        print('')
        print('This exact value must go into Firestore config/ai -> apiKey.')
        print('=' * 64)
    elif args.secret:
        secret = args.secret.strip()
        if looks_like_placeholder(secret):
            print('ERROR: "%s" looks like a placeholder copied from instructions, not a real secret.' % secret)
            print('Using it would leave the gate wide open — anyone guessing that text gets in.')
            print('Fix: run again WITHOUT --secret and the script will generate a strong one,')
            print('then paste the printed value into Firestore config/ai -> apiKey.')
            return 2
        if len(secret) < 16:
            print('ERROR: that secret is only %d characters — too short to resist guessing.' % len(secret))
            print('Fix: run again WITHOUT --secret to generate a strong one (or use `openssl rand -hex 24`).')
            return 2
    else:
        secret = generate_secret()
        print('=' * 64)
        print('GENERATED SECRET — copy this line now, you need it in step 3:')
        print('')
        print('    %s' % secret)
        print('')
        print('This exact value must go into Firestore config/ai -> apiKey.')
        print('=' * 64)

    try:
        with open(args.proxy_path, encoding='utf-8') as f:
            src = f.read()
    except FileNotFoundError:
        print('ERROR: %s not found — check the path.' % args.proxy_path, file=sys.stderr)
        return 1

    # Remember any previously baked-in secret so we can warn when it changes.
    m_prev = re.search(
        r"_PROXY_SHARED_SECRET = _os\.environ\.get\('PROXY_SHARED_SECRET',\s*'([^']*)'\)", src)
    previous_secret = m_prev.group(1) if m_prev else None

    # Upgrade path: cleanly remove any earlier version of this patch first.
    src = strip_previous_patch(src)

    lines = src.splitlines(keepends=True)

    class_idx = None
    for i, line in enumerate(lines):
        if re.match(r'^\s*class\s+\w+\(', line) and 'Handler' in line:
            class_idx = i
            break
    if class_idx is None:
        print('ERROR: could not find a "*Handler" class in ai_proxy.py.')
        print('Paste the first 30 lines of ai_proxy.py back to your assistant.')
        return 1

    class_indent = lines[class_idx][: len(lines[class_idx]) - len(lines[class_idx].lstrip())]

    # Find the class body range, its indent, and every do_* handler.
    class_end = len(lines)
    body_indent = None
    do_defs = []
    for i in range(class_idx + 1, len(lines)):
        line = lines[i]
        if not line.strip():
            continue
        indent = line[: len(line) - len(line.lstrip())]
        if len(indent) <= len(class_indent):
            class_end = i
            break
        if body_indent is None:
            body_indent = indent
        if re.match(r'^\s*def\s+do_\w+\s*\(', line):
            # never gate do_OPTIONS: browser preflights carry no Authorization
            do_defs.append(None if 'do_OPTIONS' in line else i)
    if body_indent is None:
        body_indent = class_indent + '    '
    if not do_defs:
        print('ERROR: no do_GET/do_POST methods found in the Handler class.')
        print('Paste the first 30 lines of ai_proxy.py back to your assistant.')
        return 1

    backup = args.proxy_path + '.bak-' + time.strftime('%Y%m%d-%H%M%S')
    shutil.copy2(args.proxy_path, backup)

    has_options = any(re.match(r'^\s*def\s+do_OPTIONS\s*\(', lines[j]) for j in range(class_idx + 1, class_end))

    out = []
    for i, line in enumerate(lines):
        if i == class_idx:
            out.append(SECRET_BLOCK % {'secret': secret})
            out.append(line)
            out.append(gate_method(body_indent))
            continue
        out.append(line)
        if i in do_defs:
            # match the handler body's own indentation (handles tab-indented files)
            body_ind = None
            for j in range(i + 1, min(i + 6, len(lines))):
                if lines[j].strip():
                    nxt = lines[j][: len(lines[j]) - len(lines[j].lstrip())]
                    if len(nxt) > len(line[: len(line) - len(line.lstrip())]):
                        body_ind = nxt
                    break
            if body_ind is None:
                print('WARNING: one-liner handler at line %d — gate call not inserted there; report this.' % (i + 1))
                continue
            already = any('_secret_gate()' in lines[j] for j in range(i + 1, min(i + 6, len(lines))))
            if not already:
                out.append(body_ind + 'if not self._secret_gate(): return\n')
        # add a do_OPTIONS preflight at the end of the class if the file has none
        if not has_options and i == class_end - 1:
            out.append(options_method(body_indent))

    new_src = ''.join(out)
    new_src, ah_count = fix_allow_headers(new_src)

    with open(args.proxy_path, 'w', encoding='utf-8') as f:
        f.write(new_src)

    try:
        py_compile.compile(args.proxy_path, doraise=True)
    except Exception as e:
        shutil.copy2(backup, args.proxy_path)
        print('ERROR: patched file did not compile — original restored automatically.')
        print('Detail: %s' % e)
        print('Paste this error back to your assistant.')
        return 1

    print('PATCHED OK: %s' % args.proxy_path)
    print('Backup: %s' % backup)
    print('CORS Allow-Headers lines updated: %d' % ah_count)
    if not has_options:
        print('No do_OPTIONS existed — a preflight handler was added.')
    print('')
    if previous_secret and previous_secret.strip() and previous_secret != secret:
        print('NOTE: this REPLACED the previous secret baked into the file.')
        print('Make sure Firestore config/ai -> apiKey is updated to the new value,')
        print('otherwise the app will keep getting 401 unauthorized.')
    print('')
    print('Next:')
    print('  1. Restart the proxy:')
    print('     sudo systemctl restart ai-proxy    # if the systemd unit exists')
    print('     # otherwise:  pkill -f ai_proxy.py ; sleep 1 ; nohup /usr/bin/python3 %s > /home/pi/.hermes/ai_proxy.log 2>&1 &' % args.proxy_path)
    print('  2. Preflight check (should list Authorization):')
    print('     curl -s -i -X OPTIONS https://raspberrypi.tail3a08db.ts.net/v1/chat/completions \\')
    print('       -H "Origin: https://ramihoujeiry.github.io" \\')
    print('       -H "Access-Control-Request-Method: POST" \\')
    print('       -H "Access-Control-Request-Headers: authorization, content-type" | grep -i "access-control\\|HTTP/"')
    print('  3. Secret check — run from your LAPTOP/phone, NOT from the Pi itself')
    print('     (the Pi calling its own funnel URL can hang; expect HTTP 200 or a JSON reply):')
    print('     curl -s -o /dev/null -w "%%{http_code}\\n" -X POST https://raspberrypi.tail3a08db.ts.net/v1/chat/completions \\')
    print('       -H "Authorization: Bearer %s"' % secret)
    print('  4. Health (should print {"ok":true}):')
    print('     curl -s https://raspberrypi.tail3a08db.ts.net/healthz')
    return 0


if __name__ == '__main__':
    sys.exit(main())
