# Public localhost TLS fixture

`key.pem` is an intentionally **public test key**, not a secret or deployment credential. Never use it for a real listener, configure it as a system trust anchor, or replace it with a user's certificate/key. Tests trust only this certificate on their owned local connection; normal certificate and hostname verification remain enabled.

The fixture is required by the real HTTPS proxy, Web Push receiver and browser network tests, and is copied into the isolated installed-artifact consumers. It must be present in a clean checkout; `.gitignore` only exempts these two exact paths from the general private PEM exclusion.

The committed certificate names `localhost` and `127.0.0.1`. It was generated with OpenSSL 3.6.3 using:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -subj '/CN=localhost/O=Pakka public test fixture' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
  -keyout apps/webui/test/tls/key.pem -out apps/webui/test/tls/cert.pem
```

Generation produces new bytes. An intentional renewal must preserve the failing/passing TLS evidence, record the new source/archive identity, and rerun the affected real TLS and installed consumers. Do not generate silently during a gate or bypass TLS verification to accept an expired fixture.
