export function createPersonPreference(deps) {
    return {
        /** Where `bot`'s turn may save a preference; null when no one person's own words began its work. */
        target(turn, bot) {
            return deps.userStarted(turn) ? { save: (text) => deps.aboutMe.learn({ botId: bot.id, botName: bot.name }, [text]) } : null;
        },
    };
}
