const notice = msg => new Notice(msg, 5000);
const log = msg => console.log(msg);

// --- Configuration Constants ---
const OPT_SEASON_NAME = "Season Filename Label";
const OPT_TYPE_KEY = "Validation: Frontmatter Key";
const OPT_TYPE_VAL = "Validation: Frontmatter Value";
const OPT_PARENT_LIST = "Parent List Property";

module.exports = {
    entry: start,
    settings: {
        name: "Add Season Script",
        author: "christt105",
        options: {
            [OPT_SEASON_NAME]: {
                type: "text",
                defaultValue: "Season",
                placeholder: "e.g., Season or Temporada",
                description: "The word used in the filename (e.g., Show - Season 1.md)"
            },
            [OPT_TYPE_KEY]: {
                type: "text",
                defaultValue: "type",
                placeholder: "e.g., type",
                description: "The frontmatter key to check in the parent file."
            },
            [OPT_TYPE_VAL]: {
                type: "text",
                defaultValue: "tv",
                placeholder: "e.g., tv",
                description: "The value the key must have to proceed."
            },
            [OPT_PARENT_LIST]: {
                type: "text",
                defaultValue: "seasons",
                placeholder: "e.g., seasons or temporadas",
                description: "The property in the parent note where the link will be added."
            }
        }
    }
};

async function start(params, settings) {
    const { app, quickAddApi } = params;
    const activeFile = app.workspace.getActiveFile();

    // --- Hardcoded Paths (Modify these if you change your folder structure) ---
    const FOLDER_PATH = "Media Tracker/Seasons";
    const TEMPLATE_PATH = "Templates/Season.md";

    // 1. Validation: Check if active file is Markdown
    if (!activeFile || activeFile.extension !== "md") {
        notice("⚠️ You have to be in a Markdown file.");
        return;
    }

    const cache = app.metadataCache.getFileCache(activeFile);
    const frontmatter = cache?.frontmatter;

    // 2. Validation: Check if it is a TV Series (using Settings)
    const validKey = settings[OPT_TYPE_KEY];
    const validValue = settings[OPT_TYPE_VAL];

    if (frontmatter?.[validKey] !== validValue) {
        notice(`⚠️ This note is not valid (Expected ${validKey}: ${validValue}).`);
        return;
    }

    // 3. Input: Ask for Season Number
    const seasonNumber = await quickAddApi.inputPrompt("Enter the season number");
    if (!seasonNumber) {
        notice("❌ Operation cancelled: No number entered.");
        return;
    }

    // 4. Prepare Data
    const parentTitle = frontmatter.title || activeFile.basename;
    const parentFile = activeFile.basename;
    
    // Use the configured Season Name (e.g., "Season" or "Temporada")
    const seasonLabel = settings[OPT_SEASON_NAME]; 
    const newFileName = `${parentFile} - ${seasonLabel} ${seasonNumber}.md`;
    const fullPath = `${FOLDER_PATH}/${newFileName}`;

    // 5. Check if file already exists
    const existingFile = app.vault.getAbstractFileByPath(fullPath);
    if (existingFile) {
        notice(`⚠️ The file already exists: ${fullPath}`);
        return;
    }

    // 6. Read Template
    const templateFile = app.vault.getAbstractFileByPath(TEMPLATE_PATH);
    if (!templateFile) {
        notice(`❌ Template not found: ${TEMPLATE_PATH}`);
        return;
    }

    let templateContent = await app.vault.read(templateFile);

    // 7. Replace Variables
    const parentCover = frontmatter.cover || "";
    const parentBanner = frontmatter.banner || "";

    templateContent = templateContent
        .replace(/{{PARENT_TITLE}}/g, parentTitle)
        .replace(/{{PARENT_FILE}}/g, parentFile)
        .replace(/{{SEASON_NUMBER}}/g, seasonNumber)
        .replace(/^cover:.*$/m, `cover: ${parentCover}`);

    // Add banner if it exists in parent
    if (parentBanner) {
        templateContent = templateContent.replace(/^(cover:.*)$/m, `$1\nbanner: ${parentBanner}`);
    }

    // 8. Create File
    try {
        // Ensure folder exists
        if (!app.vault.getAbstractFileByPath(FOLDER_PATH)) {
            await app.vault.createFolder(FOLDER_PATH);
        }

        const newFile = await app.vault.create(fullPath, templateContent);

        // 9. Open File
        await app.workspace.getLeaf(false).openFile(newFile);
        notice(`✅ ${seasonLabel} ${seasonNumber} created successfully.`);

        // 10. Update Parent File
        const listProperty = settings[OPT_PARENT_LIST]; // e.g., "seasons" or "temporadas"

        try {
            await app.fileManager.processFrontMatter(activeFile, (fm) => {
                if (!fm[listProperty]) {
                    fm[listProperty] = [];
                }
                
                // Create link without extension
                const link = `[[${newFileName.replace(/\.md$/, "")}]]`;

                // Ensure it's an array
                if (!Array.isArray(fm[listProperty])) {
                    fm[listProperty] = fm[listProperty] ? [fm[listProperty]] : [];
                }

                if (!fm[listProperty].includes(link)) {
                    fm[listProperty].push(link);
                }
            });
            notice(`✅ Reference added to the series.`);
        } catch (error) {
            console.error("Error updating parent frontmatter:", error);
            notice("⚠️ Season created but failed to update the series note.");
        }

    } catch (error) {
        console.error(error);
        notice(`❌ Error creating the file: ${error.message}`);
    }
}