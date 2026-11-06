"""Run on the New API host. Preserves upstream identity and existing API routes."""
from pathlib import Path
import datetime
import re
import shutil
import subprocess
import urllib.request

root = Path('/var/www/xbot-tunenest')
root.mkdir(parents=True, exist_ok=True)
config = Path('/etc/caddy/Caddyfile')
backup = Path('/root/new-api-backups') / ('widget-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(mode=0o700)
shutil.copy2(config, backup / 'Caddyfile')
if (root / 'index.html').exists():
    shutil.copy2(root / 'index.html', backup / 'index.html')
html = urllib.request.urlopen('http://127.0.0.1:3000/', timeout=15).read().decode()
assert '<div id="root"' in html and 'QuantumNous' in html
html = html.replace('</body>', '<script defer src="/tunenest-onboarding.js?v=2"></script></body>')
(root / 'index.html').write_text(html)
shutil.copy2(Path(__file__).with_name('tunenest-onboarding.js'), root / 'tunenest-onboarding.js')
for path in [root, root / 'index.html', root / 'tunenest-onboarding.js']:
    path.chmod(0o755 if path.is_dir() else 0o644)
original = config.read_text()
old = 'newadm.xbotai.cc {\n\tencode gzip zstd\n\treverse_proxy 127.0.0.1:3000\n}'
new = '''newadm.xbotai.cc {
    encode gzip zstd
    # BEGIN TuneNest onboarding
    handle /tunenest-onboarding.js {
        root * /var/www/xbot-tunenest
        header Cache-Control "no-store"
        file_server
    }
    @tunenestShell {
        method GET
        header Accept *text/html*
        not path /api /api/* /v1 /v1/* /oauth /oauth/*
    }
    handle @tunenestShell {
        root * /var/www/xbot-tunenest
        rewrite * /index.html
        header Cache-Control "no-store"
        file_server
    }
    handle {
        reverse_proxy 127.0.0.1:3000
    }
    # END TuneNest onboarding
}'''
if '# BEGIN TuneNest onboarding' in original:
    updated, count = re.subn(r'(?ms)^newadm\.xbotai\.cc \{\n.*?^\}', lambda _: new, original, count=1)
    if count != 1:
        raise RuntimeError('Cannot locate existing widget site block')
    config.write_text(updated)
else:
    if old not in original:
        raise RuntimeError('Caddy layout changed; inspect before installing')
    config.write_text(original.replace(old, new))
try:
    subprocess.run(['caddy', 'validate', '--config', str(config)], check=True)
    subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
except Exception:
    shutil.copy2(backup / 'Caddyfile', config)
    raise
print('Installed widget; rollback Caddy config:', backup / 'Caddyfile')
