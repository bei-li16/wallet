"""Local Wallet HTTPS host and iPhone certificate bootstrap. No application data is served.

Requires Python 3 and cryptography for certificate preparation; serving uses the standard library.
Private material stays outside both web roots, under release/windows-tls/private/.
"""
import argparse
import hashlib
import html
import ipaddress
import json
import os
import plistlib
import re
import socket
import ssl
import threading
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.request import ProxyHandler, build_opener, HTTPSHandler

ROOT = Path(__file__).resolve().parent
TLS_ROOT = ROOT / 'release' / 'windows-tls'
PUBLIC_NAMES = {'wallet-ca.cer', 'wallet-ca.mobileconfig', 'https-setup.html'}


def write_private(path, content):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'wb') as stream:
        stream.write(content)


def prepare(address, http_port, https_port, tls_root=TLS_ROOT):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    address = str(ipaddress.IPv4Address(address))
    allowed_networks = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8']
    if not any(ipaddress.ip_address(address) in ipaddress.ip_network(net) for net in allowed_networks):
        raise ValueError('Wallet local HTTPS requires a private or loopback IPv4 address')
    now = datetime.now(timezone.utc)
    private = tls_root / 'private'
    public = tls_root / 'public'
    private.mkdir(parents=True, exist_ok=True)
    public.mkdir(parents=True, exist_ok=True)
    ca_key_path, ca_path = private / 'ca-key.pem', public / 'wallet-ca.pem'
    if ca_key_path.exists() != ca_path.exists():
        raise ValueError('Incomplete Wallet CA. Original files were retained; repair before restarting.')
    if ca_key_path.exists():
        ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), password=None)
        ca = x509.load_pem_x509_certificate(ca_path.read_bytes())
        ca.verify_directly_issued_by(ca)
        if ca_key.public_key().public_numbers() != ca.public_key().public_numbers():
            raise ValueError('Wallet CA key mismatch')
        if not ca.not_valid_before_utc <= now < ca.not_valid_after_utc - timedelta(days=181):
            raise ValueError('Wallet CA needs renewal. A new CA must also be trusted on the phone.')
    else:
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Wallet Local HTTPS CA')])
        ca = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
              .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
              .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1825))
              .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
              .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False,
                  key_encipherment=False, data_encipherment=False, key_agreement=False,
                  key_cert_sign=True, crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
              # This CA is restricted to private/loopback IPs and localhost names.
              .add_extension(x509.NameConstraints(permitted_subtrees=[
                  x509.IPAddress(ipaddress.ip_network('10.0.0.0/8')),
                  x509.IPAddress(ipaddress.ip_network('172.16.0.0/12')),
                  x509.IPAddress(ipaddress.ip_network('192.168.0.0/16')),
                  x509.IPAddress(ipaddress.ip_network('127.0.0.0/8')),
                  x509.DNSName('localhost'),
              ], excluded_subtrees=None), critical=True)
              .sign(ca_key, hashes.SHA256()))
        write_private(ca_key_path, ca_key.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        ca_path.write_bytes(ca.public_bytes(serialization.Encoding.PEM))

    server_key_path, server_path = private / 'server-key.pem', private / 'server-chain.pem'
    renew = True
    if server_key_path.exists() and server_path.exists():
        server = x509.load_pem_x509_certificate(server_path.read_bytes())
        server_key = serialization.load_pem_private_key(server_key_path.read_bytes(), password=None)
        server.verify_directly_issued_by(ca)
        renew = (server.public_key().public_numbers() != server_key.public_key().public_numbers() or
                 server.not_valid_after_utc < now + timedelta(days=14) or
                 ipaddress.ip_address(address) not in server.extensions.get_extension_for_class(
                     x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress))
    if renew:
        server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        server = (x509.CertificateBuilder()
              .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, address)]))
              .issuer_name(ca.subject).public_key(server_key.public_key())
              .serial_number(x509.random_serial_number())
              .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=180))
              .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
              .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False,
                  key_encipherment=True, data_encipherment=False, key_agreement=False,
                  key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
              .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
              .add_extension(x509.SubjectAlternativeName([
                  x509.IPAddress(ipaddress.ip_address(address)),
                  x509.IPAddress(ipaddress.ip_address('127.0.0.1')), x509.DNSName('localhost')]), critical=False)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(server_key.public_key()), critical=False)
              .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
              .sign(ca_key, hashes.SHA256()))
        write_private(server_key_path, server_key.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        write_private(server_path, server.public_bytes(serialization.Encoding.PEM) + ca.public_bytes(serialization.Encoding.PEM))

    der = ca.public_bytes(serialization.Encoding.DER)
    (public / 'wallet-ca.cer').write_bytes(der)
    sha256 = ca.fingerprint(hashes.SHA256()).hex().upper()
    profile_id = str(uuid.uuid5(uuid.NAMESPACE_OID, sha256))
    profile = {
        'PayloadType': 'Configuration', 'PayloadVersion': 1,
        'PayloadIdentifier': 'local.wallet.https.' + sha256[:16].lower(),
        'PayloadUUID': profile_id, 'PayloadDisplayName': 'Wallet 本机 HTTPS 证书',
        'PayloadDescription': '为这台 Windows 电脑上的 Wallet HTTPS 服务安装本机根证书。',
        'PayloadOrganization': 'Wallet Local', 'PayloadRemovalDisallowed': False,
        'PayloadContent': [{
            'PayloadType': 'com.apple.security.root', 'PayloadVersion': 1,
            'PayloadIdentifier': 'local.wallet.https.root.' + sha256[:16].lower(),
            'PayloadUUID': str(uuid.uuid5(uuid.NAMESPACE_OID, sha256 + ':root')),
            'PayloadDisplayName': 'Wallet Local HTTPS CA',
            'PayloadCertificateFileName': 'wallet-ca.cer', 'PayloadContent': der,
        }],
    }
    (public / 'wallet-ca.mobileconfig').write_bytes(plistlib.dumps(profile, sort_keys=False))
    config = {
        'address': address, 'http_port': http_port, 'https_port': https_port,
        'http_url': f'http://{address}:{http_port}/', 'https_url': f'https://{address}:{https_port}/',
        'setup_url': f'http://{address}:{http_port}/https-setup/',
        'certificate_url': f'http://{address}:{http_port}/wallet-ca.mobileconfig',
        'ca_sha256': sha256, 'ca_thumbprint': ca.fingerprint(hashes.SHA1()).hex().upper(),
        'server_expires': server.not_valid_after_utc.isoformat(),
        'server_sha256': server.fingerprint(hashes.SHA256()).hex().upper(),
    }
    (public / 'https-setup.html').write_text(setup_page(config), encoding='utf-8')
    (tls_root / 'config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
    return config


def setup_page(config):
    url = html.escape(config['https_url'], quote=True)
    old = html.escape(config['http_url'], quote=True)
    fingerprint = ':'.join(config['ca_sha256'][i:i + 2] for i in range(0, 64, 2))
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Wallet · 启用手机离线使用</title><style>
:root{{color-scheme:light dark;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
body{{margin:0;background:#f4f6fa;color:#202a3e}}main{{max-width:560px;margin:auto;padding:32px 22px 60px}}
h1{{font-size:27px}}h2{{font-size:18px;margin:0 0 12px}}p,li{{line-height:1.8}}section{{background:white;padding:22px;border-radius:20px;margin:18px 0}}
a{{color:#3879df;overflow-wrap:anywhere}}.button{{display:block;background:#3879df;color:white;text-decoration:none;text-align:center;padding:16px;border-radius:14px;margin-top:16px;font-weight:600}}
.muted{{font-size:13px;color:#798396}}.fingerprint{{font-size:11px;overflow-wrap:anywhere}}
@media(prefers-color-scheme:dark){{body{{background:#10131b;color:#edf2fc}}section{{background:#1d2534}}}}
</style></head><body><main><p>Wallet · 手机设置</p><h1>启用手机离线使用</h1>
<p>手机与电脑先连接同一 Wi-Fi。完成以下设置并缓存后，可断网打开 Wallet。</p>
<section><h2>1. 保存已有账目</h2><p>如果你已在<a href="{old}">旧地址</a>记账，请在设置中分别导出各用户的 JSON 完整备份。新 HTTPS 地址拥有独立账本，之后可导入恢复。</p></section>
<section><h2>2. 下载并安装证书</h2><p>点击下面的按钮，允许下载描述文件。然后打开 iPhone「设置」→「已下载描述文件」→「安装」。输入手机锁屏密码并完成安装。</p>
<a class="button" href="/wallet-ca.mobileconfig">下载 Wallet 证书</a>
<p class="muted">描述文件仅包含一张 Wallet 根证书。名称：Wallet 本机 HTTPS 证书。</p></section>
<section><h2>3. 开启证书信任</h2><p>iPhone「设置」→「通用」→「关于本机」→「证书信任设置」，开启 <strong>Wallet Local HTTPS CA</strong> 的完全信任。</p>
<p class="muted"><a href="https://support.apple.com/zh-cn/102390">查看苹果官方说明</a></p></section>
<section><h2>4. 打开新地址并添加到桌面</h2><a class="button" href="{url}">打开 HTTPS Wallet</a><p>{url}</p>
<p>在 Safari「共享」中选择「添加到主屏幕」，保持「作为网页 App 打开」开启。新的图标指向 HTTPS 地址；旧图标仍指向原 HTTP 地址。</p></section>
<section><h2>5. 完成缓存，再验证离线</h2><p>从新图标打开 Wallet，保持联网，等设置显示「离线资源已就绪」。随后开启飞行模式，关闭并重新打开 Wallet，试记一笔并再次重开，核对记录仍在。</p>
<p class="muted">已导出的 JSON 可以导入到新地址中当前选中的用户。建议分别保留各用户的外部备份。</p></section>
<details><summary>证书信息</summary><p>Wallet Local HTTPS CA</p><p class="fingerprint">SHA-256：{fingerprint}</p>
<p class="muted">服务证书到期：{html.escape(config['server_expires'][:10])}。启动脚本会在接近到期时续签。</p></details>
</main></body></html>'''


def prepare_site():
    version = re.search(r'const VERSION\s*=\s*"([A-Za-z0-9.-]+)"',
                        (ROOT / 'sw.js').read_text(encoding='utf-8')).group(1)
    archive = ROOT / 'release' / f'wallet-ios-pwa-{version}.zip'
    expected = archive.with_suffix('.sha256').read_text(encoding='ascii').split()[0]
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise ValueError('Release ZIP checksum mismatch')
    site = ROOT / 'release' / f'windows-site-{version}'
    if not site.exists():
        with zipfile.ZipFile(archive) as package:
            for name in package.namelist():
                if not (site / name).resolve().is_relative_to(site.resolve()):
                    raise ValueError('Release ZIP contains an unsafe path')
            package.extractall(site)
    manifest = json.loads((site / 'release-manifest.json').read_text(encoding='utf-8'))
    allowed = set(manifest['files']) | {'release-manifest.json'}
    for name, metadata in manifest['files'].items():
        asset = (site / name).resolve()
        if not asset.is_relative_to(site.resolve()) or hashlib.sha256(asset.read_bytes()).hexdigest() != metadata['sha256']:
            raise ValueError('Release asset checksum mismatch: ' + name)
    return site, allowed, version


class WalletHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, public, allowed, **kwargs):
        self.public, self.allowed = Path(public), allowed
        super().__init__(*args, **kwargs)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path in ['/https-setup', '/https-setup/']:
            return self.public_file('https-setup.html')
        name = path.removeprefix('/')
        if name in PUBLIC_NAMES:
            return self.public_file(name)
        if name in ['', 'index.html']:
            self.path = '/index.html'
        elif name not in self.allowed:
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        self.do_GET()

    def copyfile(self, source, outputfile):
        if self.command != 'HEAD':
            super().copyfile(source, outputfile)

    def public_file(self, name):
        content = (self.public / name).read_bytes()
        mime = {'wallet-ca.cer': 'application/pkix-cert',
                'wallet-ca.mobileconfig': 'application/x-apple-aspen-config',
                'https-setup.html': 'text/html; charset=utf-8'}[name]
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        if name.endswith(('.cer', '.mobileconfig')):
            self.send_header('Content-Disposition', f'attachment; filename="{name}"')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(content)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None


def serve():
    config = json.loads((TLS_ROOT / 'config.json').read_text(encoding='utf-8'))
    site, allowed, version = prepare_site()
    handler = partial(WalletHandler, directory=str(site), public=TLS_ROOT / 'public', allowed=allowed)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(TLS_ROOT / 'private/server-chain.pem', TLS_ROOT / 'private/server-key.pem')
    http = ThreadingHTTPServer((config['address'], config['http_port']), handler)
    try:
        https = ThreadingHTTPServer((config['address'], config['https_port']), handler)
        https.socket = context.wrap_socket(https.socket, server_side=True)
    except Exception:
        http.server_close()
        raise
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    print(json.dumps({'ready': True, 'version': version, **config}), flush=True)
    try:
        https.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        http.shutdown()
        http.server_close()
        https.server_close()


def check():
    config = json.loads((TLS_ROOT / 'config.json').read_text(encoding='utf-8'))
    context = ssl.create_default_context(cafile=str(TLS_ROOT / 'public/wallet-ca.pem'))
    opener = build_opener(ProxyHandler({}), HTTPSHandler(context=context))
    with opener.open(config['https_url'], timeout=3) as response:
        if response.status != 200 or b'Wallet' not in response.read():
            raise ValueError('HTTPS application health check failed')
    with opener.open(config['http_url'] + 'wallet-ca.mobileconfig', timeout=3) as response:
        if response.headers.get_content_type() != 'application/x-apple-aspen-config':
            raise ValueError('iPhone profile MIME type is incorrect')
        profile = plistlib.loads(response.read())
        if len(profile['PayloadContent']) != 1 or profile['PayloadContent'][0]['PayloadType'] != 'com.apple.security.root':
            raise ValueError('iPhone profile is not the expected certificate-only profile')
    with socket.create_connection((config['address'], config['https_port']), timeout=3) as connection:
        with context.wrap_socket(connection, server_hostname=config['address']) as secure:
            tls_version = secure.version()
    print(json.dumps({'verified': True, 'tls': tls_version, 'https_url': config['https_url'],
                      'ca_sha256': config['ca_sha256']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'serve', 'check'])
    parser.add_argument('--address')
    parser.add_argument('--http-port', type=int, default=18769)
    parser.add_argument('--https-port', type=int, default=18770)
    args = parser.parse_args()
    if args.action == 'prepare':
        if not args.address:
            parser.error('--address is required for prepare')
        prepare_site()
        print(json.dumps(prepare(args.address, args.http_port, args.https_port)))
    elif args.action == 'serve':
        serve()
    else:
        try:
            check()
        except Exception as error:
            # Startup polling expects a nonzero exit code, without a PowerShell stderr exception.
            print(json.dumps({'verified': False, 'error': str(error)}))
            raise SystemExit(1)
