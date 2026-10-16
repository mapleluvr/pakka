// RFC 8291 (aes128gcm) and RFC 8292 (VAPID), using public Node crypto/TLS APIs.
// Behavior reference: pi-pocket@de612d5622cd src/server/push.ts; no Pocket storage/authority is imported.
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";
import { request } from "node:https";

export interface PushSubscriptionData {
	readonly endpoint: string;
	readonly keys: { readonly p256dh: string; readonly auth: string };
}
export interface VapidKeys {
	readonly publicKey: string;
	readonly privateKey: string;
}
export function generateVapid(): VapidKeys {
	const pair = createECDH("prime256v1");
	pair.generateKeys();
	const scalar = Buffer.alloc(32),
		raw = pair.getPrivateKey();
	raw.copy(scalar, scalar.length - raw.length);
	return Object.freeze({
		publicKey: pair.getPublicKey().toString("base64url"),
		privateKey: scalar.toString("base64url"),
	});
}
export function validVapid(value: VapidKeys): boolean {
	try {
		const scalar = Buffer.from(value.privateKey, "base64url");
		if (scalar.length !== 32 || scalar.toString("base64url") !== value.privateKey) return false;
		const pair = createECDH("prime256v1");
		pair.setPrivateKey(scalar);
		return pair.getPublicKey().toString("base64url") === value.publicKey;
	} catch {
		return false;
	}
}
export function validSubscriptionKeys(keys: PushSubscriptionData["keys"]): boolean {
	try {
		if (!/^[A-Za-z0-9_-]+$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]+$/.test(keys.auth)) return false;
		const publicKey = Buffer.from(keys.p256dh, "base64url"),
			auth = Buffer.from(keys.auth, "base64url");
		if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16) return false;
		const pair = createECDH("prime256v1");
		pair.generateKeys();
		pair.computeSecret(publicKey);
		return publicKey.toString("base64url") === keys.p256dh && auth.toString("base64url") === keys.auth;
	} catch {
		return false;
	}
}
function derive(salt: Buffer, input: Buffer, info: readonly Buffer[], length: number): Buffer {
	const prk = createHmac("sha256", salt).update(input).digest();
	const expand = createHmac("sha256", prk);
	for (const part of info) expand.update(part);
	return expand
		.update(Buffer.from([1]))
		.digest()
		.subarray(0, length);
}
function encrypt(text: string, subscription: PushSubscriptionData): Buffer {
	const plain = Buffer.from(text, "utf8");
	if (plain.length > 3000) throw Error("Notification payload exceeds record limit");
	const recipient = Buffer.from(subscription.keys.p256dh, "base64url");
	const pair = createECDH("prime256v1");
	pair.generateKeys();
	const publicKey = pair.getPublicKey(),
		salt = randomBytes(16);
	const ikm = derive(
		Buffer.from(subscription.keys.auth, "base64url"),
		pair.computeSecret(recipient),
		[Buffer.from("WebPush: info\0"), recipient, publicKey],
		32,
	);
	const cek = derive(salt, ikm, [Buffer.from("Content-Encoding: aes128gcm\0")], 16);
	const nonce = derive(salt, ikm, [Buffer.from("Content-Encoding: nonce\0")], 12);
	const cipher = createCipheriv("aes-128-gcm", cek, nonce);
	const encrypted = Buffer.concat([
		cipher.update(Buffer.concat([plain, Buffer.from([2])])),
		cipher.final(),
		cipher.getAuthTag(),
	]);
	const prefix = Buffer.alloc(21);
	salt.copy(prefix);
	prefix.writeUInt32BE(4096, 16);
	prefix[20] = publicKey.length;
	return Buffer.concat([prefix, publicKey, encrypted]);
}
function authorization(endpoint: URL, keys: VapidKeys, subject: string): string {
	const publicKey = Buffer.from(keys.publicKey, "base64url");
	const key = createPrivateKey({
		format: "jwk",
		key: {
			kty: "EC",
			crv: "P-256",
			x: publicKey.subarray(1, 33).toString("base64url"),
			y: publicKey.subarray(33).toString("base64url"),
			d: keys.privateKey,
		},
	});
	const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url");
	const claims = Buffer.from(
		JSON.stringify({ aud: endpoint.origin, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject }),
	).toString("base64url");
	const input = header + "." + claims;
	const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString(
		"base64url",
	);
	return `vapid t=${input}.${signature}, k=${keys.publicKey}`;
}
/** An HTTP acceptance is a push-service fact, not a claim of native display. No redirects/retries. */
export async function postWake(
	subscription: PushSubscriptionData,
	keys: VapidKeys,
	wake: { readonly eventId: string; readonly deviceId: string },
	options: { readonly subject: string; readonly trustedCa?: string; readonly signal: AbortSignal },
): Promise<number> {
	let endpoint: URL;
	try {
		endpoint = new URL(subscription.endpoint);
	} catch {
		throw Error("Invalid push endpoint");
	}
	if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash)
		throw Error("Invalid push endpoint");
	const body = encrypt(JSON.stringify(wake), subscription);
	return new Promise<number>((resolve, reject) => {
		const req = request(
			endpoint,
			{
				method: "POST",
				signal: options.signal,
				...(options.trustedCa ? { ca: options.trustedCa } : {}),
				headers: {
					"Content-Encoding": "aes128gcm",
					"Content-Type": "application/octet-stream",
					"Content-Length": body.length,
					TTL: "120",
					Urgency: "normal",
					Topic: wake.eventId.slice(0, 32),
					Authorization: authorization(endpoint, keys, options.subject),
				},
			},
			(response) => {
				let bytes = 0;
				response.on("data", (chunk) => {
					bytes += chunk.length;
					if (bytes > 65536) response.destroy(Error("Push response exceeds limit"));
				});
				response.once("error", reject);
				response.once("end", () => resolve(response.statusCode ?? 0));
			},
		);
		req.once("error", reject);
		req.end(body);
	});
}
