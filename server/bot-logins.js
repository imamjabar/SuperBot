import { loginPageCheck, loginPlace, loginSite } from "../shared/logins.js";
const OBSERVE_PAGE = `JSON.stringify({ href: location.href, signIn: Boolean(document.querySelector('input[type="password"], input[type="email"], input[autocomplete~="username"], input[autocomplete~="email"]')) })`;
/** Null when nothing a login could be filled on is open. */
export async function observeSignInPage(engine) {
    let value;
    try {
        value = (await engine(["eval", OBSERVE_PAGE]))?.result;
    }
    catch {
        return null;
    }
    for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
        try {
            value = JSON.parse(value);
        }
        catch {
            return null;
        }
    }
    const page = value;
    if (typeof page?.href !== "string")
        return null;
    const check = loginPageCheck(page.href);
    return check.ok ? { host: check.pageHost, signIn: page.signIn === true } : null;
}
/** The bots a login saved from `botId`'s sign-in card fills for: every bot on the same named browser profile, so the
 * bots that share its cookies also share its saved password. A bot's own or temporary browser keeps it to that bot. */
export function loginBotsFor(bots, botId) {
    const profile = bots.find((bot) => bot.id === botId)?.browserProfile;
    if (!profile || profile === "guest")
        return [botId];
    return [botId, ...bots.filter((bot) => bot.id !== botId && bot.browserProfile === profile).map((bot) => bot.id)];
}
/** A sign-in page on another site than the card's, which a login saved from the card fills only once the person, shown
 * that host on the card, confirms it: a page the bot chose must not receive a password saved for the site the card names. */
export function cardSignInElsewhere(cardHost, observed) {
    return observed?.signIn && loginSite(observed.host) !== loginSite(cardHost) ? observed.host : null;
}
/** Where a login saved from a sign-in card fills: the card's site, the sign-in page open on that site (else the card's
 * own host), and a sign-in page on another site when the person confirmed it. */
export function cardLoginPlace(cardHost, observed, confirmedHost) {
    const onSite = observed?.signIn && loginSite(observed.host) === loginSite(cardHost) ? observed.host : cardHost;
    const elsewhere = cardSignInElsewhere(cardHost, observed);
    return loginPlace(cardHost, [onSite, ...(elsewhere && confirmedHost === elsewhere ? [elsewhere] : [])]);
}
/** Saved logins and 1Password items, as each bot may use them. */
export class BotLogins {
    store;
    onePassword;
    constructor(store, onePassword) {
        this.store = store;
        this.onePassword = onePassword;
    }
    /** Where each login the bot may use fills, with its username. */
    sitesFor(botId) {
        return [...this.store.sitesFor(botId), ...this.onePassword.sitesFor(botId)];
    }
    /** Secrets are read only when one is filled. */
    async candidates(botId, pageHost) {
        await this.onePassword.fresh();
        return [
            ...this.store.usableFor(pageHost, botId).map((login) => ({
                id: login.id, site: login.site, hosts: login.hosts, exactHost: login.exactHost, username: login.username, source: login.source,
                secrets: async () => ({ password: login.password, totp: login.totp ?? null }),
            })),
            ...this.onePassword.candidates(pageHost, botId),
        ];
    }
    markUsed(id) {
        this.store.markUsed(id);
        this.onePassword.markUsed(id);
    }
    /** The settings, plus whether a 1Password token is held: what a credential card's "configured" check reads. */
    credentialConfig(config) {
        return { ...config, onePassword: { connected: Boolean(this.store.onePasswordToken()) } };
    }
    routes(botExists) {
        return {
            list: () => this.store.list(),
            create: (input) => this.store.create(input),
            update: (id, patch) => this.store.update(id, patch),
            remove: (id) => this.store.remove(id),
            botExists,
            onePassword: {
                status: () => this.onePassword.status(),
                list: () => { void this.onePassword.fresh(); return this.onePassword.list(); },
                connect: async (token) => {
                    const status = await this.onePassword.refresh(token);
                    this.store.setOnePasswordToken(token);
                    return status;
                },
                refresh: () => this.onePassword.refresh(),
                disconnect: () => {
                    this.store.setOnePasswordToken(null);
                    this.onePassword.clear();
                    return this.onePassword.status();
                },
                grant: (vaultId, bots) => {
                    if (!this.onePassword.hasVault(vaultId))
                        return null;
                    this.store.setOnePasswordGrant(vaultId, bots);
                    return this.onePassword.status();
                },
            },
        };
    }
}
