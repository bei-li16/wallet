"""Real TLS validation and certificate bootstrap checks, using disposable keys and localhost."""
import importlib.util
import ipaddress
import json
import plistlib
import socket
import ssl
import tempfile
import threading
import unittest
from datetime import timedelta
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from cryptography import x509
from cryptography.x509.oid import ExtendedKeyUsageOID

spec = importlib.util.spec_from_file_location('wallet_https', Path(__file__).parents[1] / 'windows-https.py')
H = importlib.util.module_from_spec(spec)
spec.loader.exec_module(H)


class HttpsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='wallet-https-test-')
        cls.root = Path(cls.temp.name)
        cls.tls = cls.root / 'tls'
        cls.config = H.prepare('192.168.1.3', 18769, 18770, cls.tls)
        cls.site = cls.root / 'site'
        cls.site.mkdir()
        (cls.site / 'index.html').write_text('Wallet synthetic verification', encoding='utf-8')
        (cls.site / 'private-key.pem').write_text('must-not-be-served', encoding='utf-8')
        handler = partial(H.WalletHandler, directory=str(cls.site), public=cls.tls / 'public', allowed={'index.html'})
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        cls.https = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(cls.tls / 'private/server-chain.pem', cls.tls / 'private/server-key.pem')
        cls.https.socket = context.wrap_socket(cls.https.socket, server_side=True)
        cls.threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in [cls.http, cls.https]]
        for thread in cls.threads:
            thread.start()
        cls.opener = build_opener(ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        for server in [cls.http, cls.https]:
            server.shutdown()
            server.server_close()
        for thread in cls.threads:
            thread.join(timeout=2)
        cls.temp.cleanup()

    def context(self):
        return ssl.create_default_context(cafile=str(self.tls / 'public/wallet-ca.pem'))

    def fetch(self, path):
        return self.opener.open(f'http://127.0.0.1:{self.http.server_port}{path}', timeout=3)

    def test_certificate_requirements_and_local_name_constraints(self):
        server = x509.load_pem_x509_certificate((self.tls / 'private/server-chain.pem').read_bytes())
        ca = x509.load_pem_x509_certificate((self.tls / 'public/wallet-ca.pem').read_bytes())
        server.verify_directly_issued_by(ca)
        self.assertEqual(server.public_key().key_size, 2048)
        self.assertEqual(server.signature_hash_algorithm.name, 'sha256')
        self.assertLess(server.not_valid_after_utc - server.not_valid_before_utc, timedelta(days=181))
        self.assertIn(ExtendedKeyUsageOID.SERVER_AUTH, server.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value)
        self.assertIn(ipaddress.ip_address('192.168.1.3'), server.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress))
        constraints = ca.extensions.get_extension_for_class(x509.NameConstraints).value
        self.assertTrue(any(isinstance(net, x509.IPAddress) and ipaddress.ip_address('192.168.1.3') in net.value for net in constraints.permitted_subtrees))
        self.assertFalse(any(isinstance(net, x509.IPAddress) and ipaddress.ip_address('8.8.8.8') in net.value for net in constraints.permitted_subtrees))

    def test_profile_is_certificate_only_and_uses_ios_mime(self):
        with self.fetch('/wallet-ca.mobileconfig') as response:
            self.assertEqual(response.headers.get_content_type(), 'application/x-apple-aspen-config')
            profile = plistlib.loads(response.read())
        self.assertEqual(len(profile['PayloadContent']), 1)
        payload = profile['PayloadContent'][0]
        self.assertEqual(payload['PayloadType'], 'com.apple.security.root')
        self.assertEqual(payload['PayloadContent'], (self.tls / 'public/wallet-ca.cer').read_bytes())
        self.assertFalse(profile['PayloadRemovalDisallowed'])

    def test_trusted_tls_checks_hostname_and_uses_modern_protocol(self):
        with socket.create_connection(('127.0.0.1', self.https.server_port), timeout=3) as raw:
            with self.context().wrap_socket(raw, server_hostname='127.0.0.1') as secure:
                self.assertIn(secure.version(), ['TLSv1.2', 'TLSv1.3'])
                secure.sendall(b'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
                self.assertIn(b'200 OK', secure.recv(4096))

    def test_tls_rejects_wrong_hostname(self):
        with socket.create_connection(('127.0.0.1', self.https.server_port), timeout=3) as raw:
            with self.assertRaises(ssl.SSLCertVerificationError):
                self.context().wrap_socket(raw, server_hostname='192.168.1.4')

    def test_tls_rejects_untrusted_ca(self):
        with socket.create_connection(('127.0.0.1', self.https.server_port), timeout=3) as raw:
            with self.assertRaises(ssl.SSLCertVerificationError):
                ssl.create_default_context().wrap_socket(raw, server_hostname='127.0.0.1')

    def test_allowlist_blocks_keys_traversal_and_directory_listing(self):
        for path in ['/private-key.pem', '/private/ca-key.pem', '/wallet-ca.pem', '/%2e%2e/tls/private/ca-key.pem', '/js/', '/tests/']:
            with self.assertRaises(HTTPError) as error:
                self.fetch(path)
            self.assertEqual(error.exception.code, 404)

    def test_setup_page_and_head_responses(self):
        with self.fetch('/https-setup/') as response:
            text = response.read().decode('utf-8')
            self.assertIn('https://192.168.1.3:18770/', text)
            self.assertIn('证书信任设置', text)
            self.assertIn('JSON', text)
        for path in ['/', '/wallet-ca.mobileconfig']:
            request = Request(f'http://127.0.0.1:{self.http.server_port}{path}', method='HEAD')
            with self.opener.open(request, timeout=3) as response:
                self.assertGreater(int(response.headers['Content-Length']), 0)
                self.assertEqual(response.read(), b'')

    def test_same_ca_and_leaf_are_reused_across_restarts(self):
        again = H.prepare('192.168.1.3', 18769, 18770, self.tls)
        self.assertEqual(again['ca_sha256'], self.config['ca_sha256'])
        self.assertEqual(again['server_sha256'], self.config['server_sha256'])

    def test_public_ip_is_rejected_before_generating_keys(self):
        target = self.root / 'invalid'
        with self.assertRaises(ValueError):
            H.prepare('8.8.8.8', 18769, 18770, target)
        self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
