---
title: "{{title}}"
type: <% "{{media_type}}".toLowerCase() %>
date: 
rewatches: []
release_date: "{{release_date}}"
status: Not Started
cover: "{{poster_path}}"
banner: "{{backdrop_path}}"
rating: 
genres: <%=movie.genres.map(genre=>`\n  - ${genre}`).join('')%>
tmdb_id: <%=movie.id %>
tags: []
related: []
overview: "<%= movie.overview.replace(/[\r\n]+/g, ' ').replace(/"/g, '\\"') %>"
<%* if("{{media_type}}".toLowerCase() == "tv") { -%>
seasons: []
<%* } -%>
---

<%*
const year = "{{release_date}}".split("-")[0];

// Securely grab the file where this template is running
const currentFile = tp.config.target_file;

if (year) {
    const newName = `${tp.file.title} (${year})`;
    const currentFolder = tp.file.folder(true);
    const destinationPath = `${currentFolder}/${newName}.md`;
    
    // Check if the destination already exists
    const existingFile = app.vault.getAbstractFileByPath(destinationPath);

    if (existingFile) {
        // CASE A: Duplicate found
        new Notice(`Found existing note: "${newName}". Deleting duplicate...`);
        
        // 1. Open the existing file
        await app.workspace.getLeaf(false).openFile(existingFile);
        
        // 2. Delete the current file (the duplicate)
        await app.vault.trash(currentFile, true);
        
        // 3. IMPORTANT: Stop the script immediately so it doesn't try to write to a deleted file
        return; 
        
    } else {
        // CASE B: No duplicate
        await tp.file.rename(newName);
    }
}
%>