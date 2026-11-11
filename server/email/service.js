// The person's mailboxes: connecting one (find its servers, prove it reads a real header, keep the password sealed),
// what the app shows of them, and a guard over where they connect. Shared by the Apps card, the card in a chat and a
// move from the person's computer.
import { EMAIL_SLUG } from "../../shared/email.js";
import { boxRefusal } from "../bot-box/egress-gate.js";
import { resolveTarget } from "../browser/egress/gate.js";
import { secretForms } from "../login-store.js";
import { HELD_SECRET_MASK } from "../redact.js";
import { EmailError, openGuard, pinned, testMailbox, testSending } from "./client.js";
import { discoverMailServers, liveDiscoverDeps } from "./discover.js";
import { EmailStore, MAX_EMAIL_ACCOUNTS, parseEmailAccount } from "./store.js";
const ADDRESS = /^[^\s@<>()",;:]{1,200}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu;
const HOST = /^[a-z0-9.-]{1,253}$/iu;
/** How long connecting may look for a server that answers. */
const FIND_MS = 60_000;
/** The Cloud's rule for where mail goes: refused for anything but the public internet, and connected to the address checked. */
const publicGuard = async ({ host, port }) => {
    const addresses = await resolveTarget(host);
    if (!addresses.length)
        throw new EmailError("network", "The mail server's name could not be found.");
    if (await boxRefusal({ host, port }, addresses))
        throw new EmailError("refused", "My Cloud can only reach mail servers on the public internet.");
    return pinned(host, addresses[0].address);
};
const view = (account) => ({
    address: account.address, imapHost: account.imap.host, ...(account.smtp ? { smtpHost: account.smtp.host } : {}),
    connectedAt: new Date(account.connectedAt).toISOString(), ...(account.problem ? { problem: account.problem } : {}),
});
function typed(request) {
    const imap = request.imapHost?.trim();
    if (!imap)
        return null;
    // The first port of each pair starts in TLS, the second upgrades to it; any other port is tried both ways, TLS first
    // (an upgrade on a TLS port only times out). Either way the password goes only once TLS is up.
    const on = (host, port, [tls, upgraded]) => port === tls ? [{ host, port, secure: true }] : port === upgraded ? [{ host, port, secure: false }]
        : port ? [{ host, port, secure: true }, { host, port, secure: false }] : [{ host, port: tls, secure: true }, { host, port: upgraded, secure: false }];
    return { imap: on(imap, request.imapPort, [993, 143]), smtp: request.smtpHost?.trim() ? on(request.smtpHost.trim(), request.smtpPort, [465, 587]) : [] };
}
export function createEmailService(deps) {
    const store = new EmailStore(deps.dataDir);
    /** Masks every saved password, in every form it might be written, in whatever a bot or a transcript can read. */
    const scrub = (text) => store.secretValues().flatMap(secretForms).reduce((safe, form) => (safe.includes(form) ? safe.split(form).join(HELD_SECRET_MASK) : safe), text);
    const guard = deps.guard ?? (deps.publicOnly ? publicGuard : openGuard);
    const live = deps.test ?? { mailbox: testMailbox, sending: testSending };
    const allowed = async (url) => {
        if (!deps.publicOnly)
            return true;
        await publicGuard({ host: url.hostname, port: 443 });
        return true;
    };
    const discover = deps.discover ?? liveDiscoverDeps(allowed);
    const now = deps.now ?? Date.now;
    const status = () => (deps.refusal
        ? { state: "unavailable", accounts: [], reason: deps.refusal }
        : { state: store.list().length ? "connected" : "signed-out", accounts: store.list().map(view) });
    /** Tries each place in turn. A server that refuses the password ends it there: the password goes to no other host. */
    async function signIn(address, password, username, found, deadline) {
        const local = address.slice(0, address.lastIndexOf("@"));
        const names = username ? [username] : found.username === "localpart" ? [local] : found.username === "address" ? [address] : [address, local];
        let last = null;
        for (const imap of found.imap) {
            if (now() > deadline)
                break;
            for (const name of names) {
                try {
                    return { imap, username: name, inbox: await live.mailbox({ username: name, password, imap }, guard) };
                }
                catch (error) {
                    const failed = error instanceof EmailError ? error : new EmailError("network", "The mail server did not answer.");
                    if (failed.code !== "password") {
                        last = failed;
                        break;
                    }
                    last = failed;
                    if (name === names.at(-1))
                        throw failed;
                }
            }
        }
        return last ?? new EmailError("network", "No mail server was found for this address.");
    }
    return {
        store,
        guard,
        status,
        scrub,
        mounted: () => !deps.refusal && store.list().length > 0,
        slug: EMAIL_SLUG,
        /** Connects a mailbox, or says why not. Nothing is saved until a real header has been read back. */
        async connect(request) {
            if (deps.refusal)
                return { ok: false, error: deps.refusal };
            const address = request.address.trim();
            const password = request.password;
            if (!ADDRESS.test(address))
                return { ok: false, error: "Enter your whole email address, like you@example.com." };
            if (!password)
                return { ok: false, error: "Enter the password for this mailbox." };
            for (const host of [request.imapHost, request.smtpHost])
                if (host?.trim() && !HOST.test(host.trim()))
                    return { ok: false, error: "A mail server is a name like mail.example.com.", needsServer: true };
            const existing = store.get(address);
            if (!existing && store.list().length >= MAX_EMAIL_ACCOUNTS)
                return { ok: false, error: `You can connect at most ${MAX_EMAIL_ACCOUNTS} mailboxes.` };
            const deadline = now() + FIND_MS;
            const found = typed(request) ?? await discoverMailServers(address, discover);
            if (existing && !request.imapHost?.trim()) {
                found.imap = [existing.imap, ...found.imap.filter((server) => server.host !== existing.imap.host || server.port !== existing.imap.port)];
                if (existing.smtp)
                    found.smtp = [existing.smtp, ...found.smtp.filter((server) => server.host !== existing.smtp.host || server.port !== existing.smtp.port)];
            }
            let signedIn;
            try {
                signedIn = await signIn(address, password, request.username?.trim() || undefined, found, deadline);
            }
            catch (error) {
                const failed = error instanceof EmailError ? error : new EmailError("server", "The mail server said no.");
                return { ok: false, error: failed.code === "password" ? passwordHelp(address) : failed.message };
            }
            if (signedIn instanceof EmailError) {
                if (signedIn.code === "refused")
                    return { ok: false, needsServer: true, error: signedIn.message };
                return { ok: false, needsServer: true, error: request.imapHost?.trim() ? "That mail server did not answer over a secure connection. Check its name and port." : "We couldn't find your mail server. Type its name, which your mail provider's help pages list." };
            }
            let smtp;
            let problem;
            for (const server of found.smtp) {
                if (now() > deadline)
                    break;
                try {
                    await live.sending({ username: signedIn.username, password }, server, guard);
                    smtp = server;
                    problem = undefined;
                    break;
                }
                catch (error) {
                    problem = error instanceof EmailError && error.code === "password" ? "The outgoing server did not accept this password." : "No outgoing mail server answered.";
                    if (error instanceof EmailError && error.code === "password")
                        break;
                }
            }
            if (!found.smtp.length)
                problem = "No outgoing mail server was found.";
            const account = { address, username: signedIn.username, password, imap: signedIn.imap, ...(smtp ? { smtp } : {}), connectedAt: now(), ...(smtp ? {} : { problem: `Reading works. Sending doesn't yet: ${problem ?? "No outgoing mail server was found."}` }) };
            store.put(account);
            return { ok: true, account: view(account), inbox: signedIn.inbox, sending: smtp ? { ok: true } : { ok: false, problem: problem ?? "No outgoing mail server was found." } };
        },
        disconnect(address) {
            store.remove(address);
            return status();
        },
        /** A mailbox that moved from the person's computer, with its password; My Cloud keeps one of its own at that address. */
        adopt(values) {
            let adopted = 0, kept = 0;
            for (const value of values) {
                const account = parseEmailAccount(value);
                if (!account)
                    continue;
                if (store.get(account.address) || store.list().length >= MAX_EMAIL_ACCOUNTS) {
                    kept++;
                    continue;
                }
                store.put(account);
                adopted++;
            }
            return { adopted, kept };
        },
    };
}
/** Why a password failed, with what the big providers need instead. */
function passwordHelp(address) {
    const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
    if (/^(?:gmail|googlemail)\.com$/u.test(domain))
        return "Google needs an app password here, not your normal password. For Gmail, the Gmail app in Connected apps is easier.";
    if (/^(?:outlook|hotmail|live|msn)\.[a-z.]+$/u.test(domain))
        return "Microsoft no longer lets mail programs in with a password.";
    if (/^(?:icloud|me|mac)\.com$/u.test(domain))
        return "Apple needs an app-specific password here, not your Apple account password.";
    return "The mail server did not accept this address and password. Check them and try again.";
}
