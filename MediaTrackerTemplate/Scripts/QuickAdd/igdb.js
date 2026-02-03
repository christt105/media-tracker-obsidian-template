const notice = (msg) => new Notice(msg, 5000);
const log = (msg) => console.log(msg);

const API_URL = "https://api.igdb.com/v4/games";
const AUTH_URL = "https://id.twitch.tv/oauth2/token";
const GRANT_TYPE = "client_credentials";

const savePath = "Scripts/Tokens/igdbToken.json";
const API_CLIENT_ID_OPTION = "IGDB API Client ID"
const API_CLIENT_SECRET_OPTION = "IGDB API Client secret"

var userData = { igdbToken: "" };
var AUTH_TOKEN;

module.exports = {
	entry: start,
	settings: {
		name: "Videogames Script",
		author: "christt105/Elaws",
		options: {
			[API_CLIENT_ID_OPTION]: {
				type: "text",
				defaultValue: "",
				secret: true,
				placeholder: "IGDB API Client ID",
			},
			[API_CLIENT_SECRET_OPTION]: {
				type: "text",
				defaultValue: "",
				secret: true,
				placeholder: "IGDB API Client secret",
			},
		},
	},
};

let QuickAdd;
let Settings;

async function start(params, settings) {
	QuickAdd = params;
	Settings = settings;

	await readAuthToken();

	const query = await QuickAdd.quickAddApi.inputPrompt(
		"Enter videogame title: "
	);
	if (!query) {
		notice("No query entered.");
		throw new Error("No query entered.");
	}

	const searchResults = await getByQuery(query);

	const selectedGame = await QuickAdd.quickAddApi.suggester(
		searchResults.map(formatTitleForSuggestion),
		searchResults
	);
	if (!selectedGame) {
		notice("No choice selected.");
		throw new Error("No choice selected.");
	}

	if (selectedGame.involved_companies) {
		var developer = (selectedGame.involved_companies).find(element => element.developer);
	}

	let thumbnail = "";
	if (selectedGame.cover) {
		thumbnail = "https:" + (selectedGame.cover.url).replace("thumb", "cover_big");
	}

	let banner = "";
	if (selectedGame.screenshots && selectedGame.screenshots.length > 0) {
		banner = "https:" + (selectedGame.screenshots[0].url).replace("thumb", "screenshot_huge");
	}

	// Extract Steam App ID
	let steamAppId = "";
	if (selectedGame.external_games) {
		const steamEntry = selectedGame.external_games.find(g => g.external_game_source === 1); // Category 1 is Steam
		if (steamEntry) {
			steamAppId = steamEntry.uid;

			// Use Steam official assets
			thumbnail = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_600x900_2x.jpg`;
			banner = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_hero.jpg`;
		}
	}

	QuickAdd.variables = {
		...selectedGame,
		id: selectedGame.id,
		steam_appid: steamAppId,
		fileName: replaceIllegalFileNameCharactersInString(selectedGame.name),
		// Each genre comes in {ID, NAME} pair. Here, get rid of ID to keep NAME only.
		// POST request to IGDB in apiGet(query) uses IGDB API's expander syntax (see : https://api-docs.igdb.com/#expander)
		genresFormatted: `${selectedGame.genres ? formatList((selectedGame.genres).map(item => item.name)) : " "}`,
		gameModesFormatted: `${selectedGame.game_modes ? formatList((selectedGame.game_modes).map(item => item.name)) : " "}`,
		//Developer name and logo
		developerName: `${developer ? developer.company.name : " "}`,
		developerLogo: `${developer ? (developer.company.logo ? ("https:" + developer.company.logo.url).replace("thumb", "logo_med") : " ") : " "}`,
		// For possible image size options, see : https://api-docs.igdb.com/#images
		thumbnail: `${thumbnail}`,
		banner: `${banner}`,
		// Release date is given as UNIX timestamp.
		release: `${selectedGame.first_release_date ? new Date(selectedGame.first_release_date * 1000).toISOString().split('T')[0] : " "}`,
		// A short description of the game.
		storylineFormatted: `${selectedGame.storyline ? (selectedGame.storyline).replace(/\r?\n|\r/g, " ") : " "}`,
	};
}

function formatTitleForSuggestion(resultItem) {
	return `${resultItem.name} (${(new Date((resultItem.first_release_date) * 1000)).getFullYear()
		})`;
}

async function getByQuery(query) {

	const searchResults = await apiGet(query);

	if (searchResults.message) {
		await refreshAuthToken();
		return await getByQuery(query);
	}

	if (searchResults.length == 0) {
		notice("No results found.");
		throw new Error("No results found.");
	}

	return searchResults;
}

function formatList(list) {
	if (list.length === 0 || list[0] == "N/A") return " ";
	if (list.length === 1) return `${list[0]}`;

	return list.map((item) => `\"${item.trim()}\"`).join(", ");
}

function replaceIllegalFileNameCharactersInString(string) {
	return string.replace(/[\\,#%&\{\}\/*<>$\":@.]*/g, "");
}

async function readAuthToken() {

	if (await QuickAdd.app.vault.adapter.exists(savePath)) {
		userData = JSON.parse(await QuickAdd.app.vault.adapter.read(savePath));
		AUTH_TOKEN = userData.igdbToken;
	}
	else {
		await refreshAuthToken();
	}
}

async function refreshAuthToken() {

	const authResults = await getAuthentified();

	if (!authResults.access_token) {
		notice("Auth token refresh failed.");
		throw new Error("Auth token refresh failed.");
	} else {
		AUTH_TOKEN = authResults.access_token;
		userData.igdbToken = authResults.access_token;
		await QuickAdd.app.vault.adapter.mkdir(savePath.substring(0, savePath.lastIndexOf("/")));
		await QuickAdd.app.vault.adapter.write(savePath, JSON.stringify(userData));
	}
}

async function getAuthentified() {
	let finalURL = new URL(AUTH_URL);

	finalURL.searchParams.append("client_id", Settings[API_CLIENT_ID_OPTION]);
	finalURL.searchParams.append("client_secret", Settings[API_CLIENT_SECRET_OPTION]);
	finalURL.searchParams.append("grant_type", GRANT_TYPE);

	const res = await request({
		url: finalURL.href,
		method: 'POST',
		cache: 'no-cache',
		headers: {
			'Content-Type': 'application/json'
		}
	})
	return JSON.parse(res);
}

async function apiGet(query) {
	try {
		const res = await request({
			url: API_URL,
			method: 'POST',
			cache: 'no-cache',
			headers: {
				'Client-ID': Settings[API_CLIENT_ID_OPTION],
				'Authorization': "Bearer " + AUTH_TOKEN
			},
			body: buildQueryBody(query)
		});

		return JSON.parse(res);
	} catch (error) {
		console.error("IGDB API error:", error);
		await refreshAuthToken();
		return await apiGet(query);
	}
}

function buildQueryBody(query) {
	const baseFields = `
		fields name, first_release_date, involved_companies.developer,
		involved_companies.company.name, involved_companies.company.logo.url,
		url, cover.url, genres.name, game_modes.name, storyline, screenshots.url,
		external_games.external_game_source, external_games.uid;
	`;

	// Si la query es un número, busca por ID
	if (!isNaN(query)) {
		return baseFields + `where id = ${query}; limit 1;`;
	}
	// Si es texto, busca por nombre
	else {
		return baseFields + `search "${query}"; limit 15;`;
	}
}
