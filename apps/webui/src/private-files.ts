import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import { dirname, resolve, parse } from "node:path";
const execute = promisify(execFile);

/** Only metadata paths enter this helper process; never credentials or arbitrary shell code. */
async function windowsAcl(path: string, initialize: boolean): Promise<void> {
	const env: NodeJS.ProcessEnv = {};
	for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE"])
		if (process.env[key]) env[key] = process.env[key];
	env.PAKKA_PRIVATE_PATH = path;
	const script =
		`$ErrorActionPreference='Stop'; $p=$env:PAKKA_PRIVATE_PATH; $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $system=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'); $item=Get-Item -LiteralPath $p -Force; if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse path refused'}; ` +
		(initialize
			? `$acl=if($item.PSIsContainer){[System.Security.AccessControl.DirectorySecurity]::new()}else{[System.Security.AccessControl.FileSecurity]::new()}; $acl.SetOwner($me); $acl.SetAccessRuleProtection($true,$false); foreach($sid in @($me,$system)){ $rule=if($item.PSIsContainer){[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow')}; $acl.AddAccessRule($rule) }; Set-Acl -LiteralPath $p -AclObject $acl; `
			: "") +
		`$acl=Get-Acl -LiteralPath $p; if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $me.Value){throw 'Foreign owner'}; $allowed=@($me.Value,$system.Value); foreach($r in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $allowed -notcontains $r.IdentityReference.Value){throw 'Non-private ACL'}}; if(-not $acl.AreAccessRulesProtected -and -not $item.PSIsContainer){$parent=Get-Acl -LiteralPath $item.DirectoryName; if(-not $parent.AreAccessRulesProtected){throw 'Unprotected parent ACL'}};`;
	try {
		await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
			env,
			windowsHide: true,
			maxBuffer: 8192,
		});
	} catch {
		throw new Error("Private Windows ACL verification failed");
	}
}
export async function assertPlainPath(path: string): Promise<void> {
	let current = resolve(path);
	while (true) {
		const stat = await lstat(current);
		if (stat.isSymbolicLink()) throw new Error("Symbolic/reparse path refused");
		if (current === parse(current).root) break;
		current = dirname(current);
	}
	const input = await lstat(path),
		physical = await lstat(await realpath(path));
	if (input.dev !== physical.dev || input.ino !== physical.ino)
		throw new Error("Redirected physical identity refused");
}
export async function verifyPrivatePath(path: string): Promise<void> {
	await assertPlainPath(path);
	const stat = await lstat(path);
	if (stat.isFile() && stat.nlink !== 1) throw new Error("Linked private file refused");
	if (process.platform === "win32") await windowsAcl(path, false);
	else if ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))
		throw new Error("Private owner/mode verification failed");
}
export async function privateDirectory(path: string): Promise<void> {
	await assertPlainPath(dirname(path));
	let created = false;
	try {
		await mkdir(path, { mode: 0o700 });
		created = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	if (created && process.platform === "win32") await windowsAcl(path, true);
	if (!(await lstat(path)).isDirectory()) throw new Error("Private directory required");
	await verifyPrivatePath(path);
}
export async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await verifyPrivatePath(dirname(path));
	const file = await open(path, "wx", 0o600);
	try {
		if (process.platform === "win32") await windowsAcl(path, true);
		await verifyPrivatePath(path);
		await file.writeFile(JSON.stringify(value) + "\n");
		await file.sync();
	} finally {
		await file.close();
	}
	await verifyPrivatePath(path);
}
export async function replacePrivateJson(path: string, value: unknown): Promise<void> {
	await verifyPrivatePath(dirname(path));
	const temporary = path + "." + crypto.randomUUID() + ".tmp";
	await writePrivateJson(temporary, value);
	const stat = await lstat(path);
	await verifyPrivatePath(path);
	const current = await lstat(path);
	if (stat.ino !== current.ino || stat.dev !== current.dev)
		throw new Error("Private publication identity changed");
	await rename(temporary, path);
	await verifyPrivatePath(path);
}
export async function readPrivateJson(path: string): Promise<unknown> {
	await verifyPrivatePath(dirname(path));
	await verifyPrivatePath(path);
	const before = await lstat(path);
	if (!before.isFile() || before.size > 131072) throw new Error("Invalid private file size");
	const bytes = await readFile(path);
	const after = await lstat(path);
	if (before.ino !== after.ino || before.dev !== after.dev || bytes.length > 131072)
		throw new Error("Private file changed");
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new Error("Invalid private JSON encoding or syntax");
	}
}
