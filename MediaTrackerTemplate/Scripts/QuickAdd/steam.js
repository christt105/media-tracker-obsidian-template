module.exports = async (params) => {
    const { app, quickAddApi, obsidian } = params;
    const { Notice, requestUrl } = obsidian;

    const activeFile = app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
        new Notice("⚠️ You must be in an Obsidian note.");
        return;
    }

    // 1. Get Query
    const currentTitle = activeFile.basename;
    const query = await quickAddApi.inputPrompt(
        "Search game on Steam:",
        "Game name",
        currentTitle
    );

    if (!query) return;

    // 2. Search Steam
    new Notice(`🔍 Searching for "${query}" on Steam...`);

    try {
        const response = await requestUrl({
            url: `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}`,
        });

        if (response.status !== 200) {
            throw new Error(`Status ${response.status}`);
        }

        const data = response.json;
        if (!data.items || data.items.length === 0) {
            new Notice("❌ No games found on Steam.");
            return;
        }

        // 3. Select Game
        const selectedGame = await quickAddApi.suggester(
            data.items.map(g => `${g.name} (ID: ${g.id})`),
            data.items
        );

        if (!selectedGame) return;

        // 4. Update Frontmatter
        await app.fileManager.processFrontMatter(activeFile, (fm) => {
            fm.steam_appid = selectedGame.id;
        });

        new Notice(`✅ Steam App ID (${selectedGame.id}) saved.`);

    } catch (error) {
        console.error("Steam Search Error:", error);
        new Notice("❌ Error searching on Steam. Check the console.");
    }
};