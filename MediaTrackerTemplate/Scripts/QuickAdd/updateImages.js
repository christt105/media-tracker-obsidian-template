const TMDB_API_URL = "https://api.themoviedb.org/3";
const STEAMGRIDDB_API_URL = "https://www.steamgriddb.com/api/v2";
const SETTINGS_PATH = "Scripts/Tokens/tmdbToken.json";
const STEAMGRIDDB_SETTINGS_PATH = "Scripts/Tokens/steamGridDbToken.json";
const MOVIE_SEARCH_PLUGIN_PATH = ".obsidian/plugins/movie-search/data.json";

const STEAMGRIDDB_TOKEN_OPTION = "SteamGridDB Token";

module.exports = {
    entry: start,
    settings: {
        name: "Update Images Script",
        author: "christt105",
        options: {
            [STEAMGRIDDB_TOKEN_OPTION]: {
                type: "text",
                defaultValue: "",
                secret: true,
                placeholder: "SteamGridDB API Key",
            },
        },
    },
};

async function start(params, settings) {
    const { app, quickAddApi, obsidian } = params;
    const { SuggestModal, Notice, requestUrl } = obsidian;

    const activeFile = app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
        new Notice("⚠️ You must be in an Obsidian note.");
        return;
    }

    // 1. Get Tokens
    const tmdbToken = await getTmdbToken(app, quickAddApi, Notice);
    if (!tmdbToken) return;

    // 2. Identify Context
    const cache = app.metadataCache.getFileCache(activeFile);
    const frontmatter = cache?.frontmatter;

    let tmdbId = frontmatter?.tmdb_id;
    let mediaType = frontmatter?.type;
    let seasonNumber = frontmatter?.season_number;

    // Handle Season context parent lookup
    if (mediaType === "season" && frontmatter?.serie) {
        const seriePath = frontmatter.serie.replace(/[\[\]]/g, "");
        const parentFile = app.metadataCache.getFirstLinkpathDest(seriePath, activeFile.path);
        if (parentFile) {
            tmdbId = app.metadataCache.getFileCache(parentFile)?.frontmatter?.tmdb_id;
        }
    }

    if (!tmdbId && mediaType !== "videogame") {
        new Notice("❌ 'tmdb_id' not found in this note or its parent.");
        return;
    }

    // 3. Select Action
    const imageType = await quickAddApi.suggester(
        ["Cover (Poster)", "Banner (Backdrop)"],
        ["poster", "backdrop"]
    );
    if (!imageType) return;

    // 4. Fetch Images
    let images = [];
    try {
        if (mediaType === "videogame") {
            const sgdbToken = settings[STEAMGRIDDB_TOKEN_OPTION] || await getSteamGridDBToken(app, quickAddApi, Notice);
            if (!sgdbToken) return;

            images = await handleVideogameImages(app, quickAddApi, requestUrl, activeFile, frontmatter, sgdbToken, imageType, Notice);
        } else {
            images = await fetchTmdbImages(tmdbToken, tmdbId, mediaType, seasonNumber, imageType, requestUrl);
        }
    } catch (e) {
        handleError(e, Notice);
        return;
    }

    if (!images || images.length === 0) {
        new Notice("⚠️ No images found.");
        return;
    }

    // 5. Select and Save Image
    // Minimal Suggest Modal
    class ImageSuggestModal extends obsidian.SuggestModal {
        constructor(app, images, onChoose, page = 0) {
            super(app);
            this.allImages = images;
            this.onChoose = onChoose;
            this.page = page;
            this.pageSize = 5;
        }

        getSuggestions(query) {
            const start = this.page * this.pageSize;
            const items = this.allImages.slice(start, start + this.pageSize);

            if (start + this.pageSize < this.allImages.length) items.push({ nav: 'next', label: "➡️ Next" });
            if (this.page > 0) items.push({ nav: 'prev', label: "⬅️ Previous" });
            items.push({ nav: 'cancel', label: "❌ Cancel" });
            return items;
        }

        renderSuggestion(item, el) {
            if (item.nav) {
                el.createDiv({ text: item.label, cls: "nav-item", attr: { style: "font-weight:bold; text-align:center; padding:10px;" } });
                return;
            }

            const container = el.createDiv({ attr: { style: "display:flex; flex-direction:column; align-items:center; gap:5px; padding:5px;" } });
            const imgUrl = item.thumb || `https://image.tmdb.org/t/p/w780${item.file_path}`;

            container.createEl("img", { attr: { src: imgUrl, style: "max-width:200px; border-radius:5px;" } });

            const info = item.author
                ? `👤 ${item.author.name} | ⭐ ${item.score}`
                : `⭐ ${item.vote_average} | 🗳️ ${item.vote_count}`;

            container.createDiv({ text: info, attr: { style: "font-size:0.8em;" } });
            container.createDiv({ text: `${item.width}x${item.height}`, attr: { style: "font-size:0.7em; opacity:0.7;" } });
        }

        onChooseSuggestion(item) {
            if (item.nav) {
                if (item.nav === 'next') new ImageSuggestModal(this.app, this.allImages, this.onChoose, this.page + 1).open();
                if (item.nav === 'prev') new ImageSuggestModal(this.app, this.allImages, this.onChoose, this.page - 1).open();
                if (item.nav === 'cancel') this.onChoose(null);
            } else {
                this.onChoose(item);
            }
        }
    }

    const selectedImage = await new Promise((resolve) => {
        new ImageSuggestModal(app, images, resolve, 0).open();
    });

    if (selectedImage) {
        const propName = imageType === "poster" ? "cover" : "banner";
        const imageUrl = selectedImage.url || `https://image.tmdb.org/t/p/original${selectedImage.file_path}`;

        await app.fileManager.processFrontMatter(activeFile, (fm) => {
            fm[propName] = imageUrl;
            // Save IDs if newly discovered
            if (selectedImage.sgdbId) fm.steamgriddb_id = selectedImage.sgdbId;
            if (selectedImage.steamAppId) fm.steam_appid = selectedImage.steamAppId;
        });
        new Notice(`✅ ${propName} updated.`);
    }
}

// --- Logic Handlers ---

async function handleVideogameImages(app, quickAddApi, requestUrl, activeFile, frontmatter, token, imageType, Notice) {
    let sgdbId = frontmatter?.steamgriddb_id;
    let steamAppId = frontmatter?.steam_appid;

    // Try to resolve IDs if missing
    if (steamAppId && !sgdbId) {
        try {
            const game = await getGameBySteamAppId(token, steamAppId, requestUrl);
            if (game) sgdbId = game.id;
        } catch (e) { console.warn("SGDB ID lookup failed", e); }
    }

    if (!sgdbId) {
        const query = await quickAddApi.inputPrompt("Search game on SteamGridDB:", null, frontmatter?.title || activeFile.basename);
        if (!query) return [];

        const results = await searchSteamGridDB(token, query, requestUrl);
        if (!results.length) return [];

        const selected = await quickAddApi.suggester(
            results.map(g => `${g.name} (${new Date(g.release_date * 1000).getFullYear()})`),
            results
        );
        if (!selected) return [];
        sgdbId = selected.id;
    }

    if (sgdbId && !steamAppId) {
        try {
            const details = await getGameDetails(token, sgdbId, requestUrl);
            steamAppId = details.steam_appid || details.platforms?.steam?.id;
        } catch (e) { console.warn("Steam App ID lookup failed", e); }
    }

    // Fetch images with both IDs (prioritizes official steam if appid exists)
    const images = await fetchSteamGridDBImages(token, sgdbId, steamAppId, imageType, requestUrl);

    // Attach IDs to images so we can save them later if selected
    images.forEach(img => {
        img.sgdbId = sgdbId;
        img.steamAppId = steamAppId;
    });

    return images;
}

async function fetchTmdbImages(token, id, mediaType, seasonNumber, imageType, requestUrl) {
    let endpoint = "";
    if (mediaType === "movie") endpoint = `/movie/${id}/images`;
    else if (mediaType === "tv") endpoint = `/tv/${id}/images`;
    else if (mediaType === "season") endpoint = `/tv/${id}/season/${seasonNumber}/images`;
    else throw new Error(`Unknown media type: ${mediaType}`);

    const isBearer = token.length > 100;
    const url = `${TMDB_API_URL}${endpoint}?include_image_language=en,null` + (!isBearer ? `&api_key=${token}` : "");
    const headers = { "Content-Type": "application/json", ...(isBearer && { "Authorization": `Bearer ${token}` }) };

    const response = await requestUrl({ url, headers });
    if (response.status !== 200) throw new Error(`TMDB Error ${response.status}`);

    const results = imageType === "poster" ? response.json.posters : response.json.backdrops;
    return results.sort((a, b) => b.vote_average - a.vote_average);
}

// --- Helpers & Modals ---

async function getTmdbToken(app, quickAddApi, Notice) {
    const adapter = app.vault.adapter;

    // Check local file
    if (await adapter.exists(SETTINGS_PATH)) {
        const data = JSON.parse(await adapter.read(SETTINGS_PATH));
        if (data.tmdb_token) return data.tmdb_token;
    }
    // Check Movie Search plugin
    if (await adapter.exists(MOVIE_SEARCH_PLUGIN_PATH)) {
        try {
            const pluginData = JSON.parse(await adapter.read(MOVIE_SEARCH_PLUGIN_PATH));
            if (pluginData.api_key) return pluginData.api_key;
        } catch (e) { }
    }
    // Prompt
    const token = await quickAddApi.inputPrompt("Enter TMDB API Key");
    if (token) {
        await adapter.write(SETTINGS_PATH, JSON.stringify({ tmdb_token: token }));
        return token;
    }
    new Notice("❌ TMDB Token required.");
    return null;
}

async function getSteamGridDBToken(app, quickAddApi, Notice) {
    const adapter = app.vault.adapter;
    if (await adapter.exists(STEAMGRIDDB_SETTINGS_PATH)) {
        const data = JSON.parse(await adapter.read(STEAMGRIDDB_SETTINGS_PATH));
        if (data.steamgriddb_token) return data.steamgriddb_token;
    }
    const token = await quickAddApi.inputPrompt("Enter SteamGridDB API Key");
    if (token) {
        await adapter.write(STEAMGRIDDB_SETTINGS_PATH, JSON.stringify({ steamgriddb_token: token }));
        return token;
    }
    new Notice("❌ SteamGridDB Token required.");
    return null;
}

function handleError(e, Notice) {
    if (e.message.includes("401")) new Notice("❌ Error 401: Invalid Token.");
    else new Notice(`❌ Error: ${e.message}`);
}

// API Wrappers
async function searchSteamGridDB(token, query, requestUrl) {
    const res = await requestUrl({
        url: `${STEAMGRIDDB_API_URL}/search/autocomplete/${encodeURIComponent(query)}`,
        headers: { "Authorization": `Bearer ${token}` }
    });
    return res.status === 200 ? res.json.data : [];
}

async function getGameDetails(token, gameId, requestUrl) {
    const res = await requestUrl({
        url: `${STEAMGRIDDB_API_URL}/games/id/${gameId}?platformdata=steam`,
        headers: { "Authorization": `Bearer ${token}` }
    });
    return res.status === 200 ? res.json.data : {};
}

async function getGameBySteamAppId(token, steamAppId, requestUrl) {
    const res = await requestUrl({
        url: `${STEAMGRIDDB_API_URL}/games/steam/${steamAppId}`,
        headers: { "Authorization": `Bearer ${token}` }
    });
    return res.status === 200 ? res.json.data : null;
}

async function fetchSteamGridDBImages(token, gameId, steamAppId, imageType, requestUrl) {
    const type = imageType === "poster" ? "grids" : "heroes";
    let images = [];

    if (steamAppId) {
        const officialUrl = imageType === "poster"
            ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_600x900_2x.jpg`
            : `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_hero.jpg`;

        images.push({
            id: 'official_steam', url: officialUrl, thumb: officialUrl,
            width: imageType === "poster" ? 600 : 1920, height: imageType === "poster" ? 900 : 620,
            score: 999, style: "Official Steam", author: { name: "Valve" }
        });
    }

    const res = await requestUrl({
        url: `${STEAMGRIDDB_API_URL}/${type}/game/${gameId}?dimensions=${imageType === "poster" ? "600x900" : "1920x620,1600x650"}`,
        headers: { "Authorization": `Bearer ${token}` }
    });

    if (res.status === 200) {
        images = [...images, ...res.json.data.map(img => ({ ...img, vote_average: img.score || 0 }))];
    }
    return images;
}

