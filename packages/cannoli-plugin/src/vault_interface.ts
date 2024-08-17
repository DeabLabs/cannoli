import Cannoli from "./main";
import { Reference, ReferenceType, FileManager, CannoliNode, ContentNodeType } from "@deablabs/cannoli-core";
import { App, DropdownComponent, Modal, resolveSubpath, TextAreaComponent, TextComponent, ToggleComponent } from "obsidian";
import { getAPI } from "obsidian-dataview";
import * as yaml from "js-yaml";
import moment from 'moment';

export class VaultInterface implements FileManager {
	private cannoli: Cannoli;

	constructor(cannoli: Cannoli) {
		this.cannoli = cannoli;

		this.replaceDataviewQueries = this.replaceDataviewQueries.bind(this);
		this.replaceSmartConnections = this.replaceSmartConnections.bind(this);
	}

	async editNote(
		reference: Reference,
		newContent: string,
		isMock: boolean,
		append?: boolean,
	): Promise<void | null> {
		// Only edit the file if we're not mocking
		if (isMock) {
			return;
		}

		// Get the file
		const filename = reference.name.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return null;
		}

		if (append) {
			await this.cannoli.app.vault.process(file, (content) => {
				return content + newContent;
			});
			// If the active file is the file we just edited, update the editor
			if (
				this.cannoli.app.workspace.activeEditor?.file?.basename ===
				file.basename
			) {
				// If the content is a user template, wait a bit and then move the cursor to the end of the file
				const userTemplate =
					"\n\n" +
					this.cannoli.settings.chatFormatString
						?.replace("{{role}}", "User")
						.replace("{{content}}", "");

				if (newContent === userTemplate) {
					await new Promise((resolve) => setTimeout(resolve, 40));
				}

				// If the setting is enabled, scroll to the end of the file
				if (this.cannoli.settings.autoScrollWithTokenStream) {
					// Set the cursor to the end of the file
					this.cannoli.app.workspace.activeEditor?.editor?.setCursor(
						this.cannoli.app.workspace.activeEditor?.editor?.lineCount() ||
						0,
						0
					);
				}
			}
		} else {
			if (reference.includeProperties) {
				await this.cannoli.app.vault.modify(file, newContent);
			} else {
				await this.cannoli.app.vault.process(file, (content) => {
					// If includeProperties is false, the edit shouldn't change the yaml frontmatter
					const yamlFrontmatter = content.match(
						/^---\n[\s\S]*?\n---\n/
					)?.[0];

					if (yamlFrontmatter) {
						return yamlFrontmatter + newContent;
					} else {
						return newContent;
					}
				});
			}
		}

		return;
	}

	async getFile(
		fileName: string,
	): Promise<ArrayBuffer | null> {
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			fileName,
			""
		);

		if (!file) {
			return null;
		}

		return await this.cannoli.app.vault.readBinary(file);
	}

	async getNote(
		reference: Reference,
		isMock: boolean,
		recursionCount = 0
	): Promise<string | null> {
		// If we're mocking, return a mock response
		if (isMock) {
			return `# ${reference.name}\nMock note content`;
		}

		// If the note is formatted with the path, get rid of the path and just use the note name
		if (reference.name.includes("|")) {
			reference.name = reference.name.split("|")[1];
		}

		// Get the file
		const filename = reference.name.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return null;
		}

		// Read the file
		let content = await this.cannoli.app.vault.read(file);

		if (reference.subpath) {
			const metadata = this.cannoli.app.metadataCache.getCache(file.path);

			if (!metadata) return null;

			const subpath = resolveSubpath(metadata, reference.subpath);

			if (!subpath) return null;

			const startLine = subpath.start.line;
			const endLine: number | null = subpath.end?.line ?? null;

			const lines = content.split("\n");

			if (endLine) {
				if (startLine === endLine) {
					return lines[startLine].trim();
				} else {
					content = lines.slice(startLine, endLine).join("\n");
				}
			} else {
				content = lines.slice(startLine).join("\n");
			}

			// If includeLink is true, add the markdown link
			if (reference.includeLink) {
				const link = `[[${file.path}#${reference.subpath}]]`;
				content = link + "\n\n" + content;
			}

			content = content.trim();

			if (content === "") {
				return null;
			}
		} else {
			// If includeProperties is false, check for yaml frontmatter and remove it
			if (
				reference.includeProperties ??
				this.cannoli.settings.includePropertiesInExtractedNotes
			) {
				// Empty
			} else {
				const yamlFrontmatter = content.match(
					/^---\n[\s\S]*?\n---\n/
				)?.[0];

				if (yamlFrontmatter) {
					content = content.replace(yamlFrontmatter, "");
				}
			}

			// If includeLink is true, add the markdown link
			if (reference.includeLink) {
				const link = `[[${file.path}]]`;
				content = link + "\n\n" + content;
			}

			// If includeFilenameAsHeader is true, add the filename as a header
			if (
				reference.includeName ??
				this.cannoli.settings.includeFilenameAsHeader
			) {
				const header = `# ${file.basename}\n`;
				content = header + content;
			}
		}

		const embeddedNotes = content.match(/!\[\[[\s\S]*?\]\]/g);

		if (embeddedNotes) {
			for (const embeddedNote of embeddedNotes) {
				let noteName = embeddedNote
					.replace("![[", "")
					.replace("]]", "");

				let subpath;

				// Image extensions
				const imageExtensions = [".jpg", ".png", ".jpeg", ".gif", ".bmp", ".tiff", ".webp", ".svg", ".ico", ".jfif", ".avif"];
				if (imageExtensions.some(ext => noteName.endsWith(ext))) {
					continue;
				}

				// If there's a pipe, split and use the first part as the note name
				if (noteName.includes("|")) {
					noteName = noteName.split("|")[0];
				}

				// If there's a "#", split and use the first part as the note name, and the second part as the heading
				if (noteName.includes("#")) {
					const split = noteName.split("#");
					noteName = split[0];
					subpath = split[1];
				}

				// Check for recursive embedded notes
				if (noteName === reference.name) {
					continue;
				}

				// Check for recursion limit (hardcoded to 10 for now)
				if (recursionCount > 10) {
					console.error(
						`Recursion limit reached while extracting note "${noteName}".`
					);
					continue;
				}

				const noteContent = await this.getNote(
					{
						name: noteName,
						type: ReferenceType.Note,
						shouldExtract: true,
						includeName: true,
						subpath: subpath,
					},
					isMock,
					recursionCount + 1,

				);

				if (noteContent) {
					const blockquotedNoteContent =
						"> " + noteContent.replace(/\n/g, "\n> ");
					content = content.replace(
						embeddedNote,
						blockquotedNoteContent
					);
				}
			}
		}

		// Render dataview queries
		content = await this.replaceDataviewQueries(content, isMock);

		// Render smart connections
		content = await this.replaceSmartConnections(content, isMock);

		return content;
	}

	async replaceDataviewQueries(content: string, isMock: boolean, node?: CannoliNode): Promise<string> {
		if (node && node.type === ContentNodeType.Http) {
			return content;
		}

		const nonEmbedRegex = /```dataview\n([\s\S]*?)\n```/g;
		const embedRegex = /{{\n```dataview\n([\s\S]*?)\n```\n([^\n]*)}}/g;
		const anyDataviewRegex = /```dataview\n([\s\S]*?)\n```/;

		if (!anyDataviewRegex.test(content)) {
			return content;
		}


		const dvApi = getAPI(this.cannoli.app);
		if (!dvApi) {
			return content;
		}


		// Handle embedded dataview queries

		let embedMatch;
		const embedMatches = [];
		// Extract all matches first
		while ((embedMatch = embedRegex.exec(content)) !== null) {
			embedMatches.push({
				fullMatch: embedMatch[0],
				query: embedMatch[1],
				modifiers: embedMatch[2],
				index: embedMatch.index
			});
		}

		// Reverse the matches array to process from last to first
		embedMatches.reverse();

		// Process each match asynchronously
		for (const match of embedMatches) {
			let includeName = false;
			let includeProperties = false;
			let includeLink = false;

			if (match.modifiers.includes('!#')) {
				includeName = false;
			} else if (match.modifiers.includes('#')) {
				includeName = true;
			} else {
				includeName = this.cannoli.settings.includeFilenameAsHeader;
			}

			if (match.modifiers.includes('!^')) {
				includeProperties = false;
			} else if (match.modifiers.includes('^')) {
				includeProperties = true;
			} else {
				includeProperties = this.cannoli.settings.includePropertiesInExtractedNotes;
			}

			if (match.modifiers.includes('!@')) {
				includeLink = false;
			} else if (match.modifiers.includes('@')) {
				includeLink = true;
			} else {
				includeLink = this.cannoli.settings.includeLinkInExtractedNotes;
			}

			const dvApi = getAPI(this.cannoli.app);
			if (!dvApi) {
				continue;
			}

			const queryResult = await dvApi.queryMarkdown(match.query);
			const result = queryResult.successful ? queryResult.value : "Invalid dataview query";

			const resultLinksReplaced = await this.replaceLinks(result, includeName, includeProperties, includeLink, isMock);

			// Replace the original text with the result
			content = content.substring(0, match.index) + resultLinksReplaced + content.substring(match.index + match.fullMatch.length);
		}

		// Handle normal dataview queries
		let nonEmbedMatch;
		const nonEmbedMatches = [];

		while ((nonEmbedMatch = nonEmbedRegex.exec(content)) !== null) {
			nonEmbedMatches.push({
				fullMatch: nonEmbedMatch[0],
				query: nonEmbedMatch[1],
				index: nonEmbedMatch.index
			});
		}

		// Reverse the matches array to process from last to first
		nonEmbedMatches.reverse();

		// Process each match asynchronously
		for (const match of nonEmbedMatches) {
			const queryResult = await dvApi.queryMarkdown(match.query);
			let result = queryResult.successful ? queryResult.value : "Invalid Dataview query";

			// Check if the result is a single line list, and if so, remove the bullet point
			if (result.startsWith("- ") && result.split("\n").length === 2) {
				result = result.substring(2);
			}

			// Replace the original text with the result
			content = content.substring(0, match.index) + result + content.substring(match.index + match.fullMatch.length);
		}

		return content;
	}

	async queryDataviewList(query: string): Promise<string[] | Error> {
		const dvApi = getAPI(this.cannoli.app);
		if (!dvApi) {
			return new Error("Dataview plugin not found");
		}

		const testResult = await dvApi.query(query);

		if (!testResult.successful) {
			return new Error(testResult.error);
		} else if (testResult.value.type !== "list") {
			return new Error("Dataview query result must be a list");
		}

		const result = await dvApi.queryMarkdown(query);

		const markdownList = result.successful ? result.value : "Invalid Dataview query";

		// Turn the markdown list into an array of strings and clean up the list items
		const list = markdownList.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0) // Remove empty lines
			.map((line) => line.replace(/^- /, "")); // Remove the leading "- "

		return list;
	}

	async replaceLinks(resultContent: string, includeName: boolean, includeProperties: boolean, includeLink: boolean, isMock: boolean): Promise<string> {
		const linkRegex = /\[\[([^\]]+)\]\]/g;
		let processedContent = "";
		let lastIndex = 0;
		let match;
		while ((match = linkRegex.exec(resultContent)) !== null) {
			processedContent += resultContent.substring(lastIndex, match.index);

			const reference = {
				name: match[1],
				type: ReferenceType.Note,
				shouldExtract: true,
				includeName: includeName,
				includeProperties: includeProperties,
				includeLink: includeLink
			};

			const noteContent = await this.getNote(reference, isMock);

			// If the processed content ends with "- ", remove it
			if (processedContent.endsWith("- ")) {
				processedContent = processedContent.substring(0, processedContent.length - 2);
			}

			processedContent += noteContent;
			lastIndex = match.index + match[0].length;
		}
		processedContent += resultContent.substring(lastIndex);

		return processedContent;
	}

	async replaceSmartConnections(content: string, isMock: boolean, node?: CannoliNode): Promise<string> {
		if (node && node.type === ContentNodeType.Http) {
			return content;
		}

		const nonEmbedRegex = /```smart-connections\n([\s\S]*?)\n```/g;
		const embedRegex = /{{([^\n]*)\n```smart-connections\n([\s\S]*?)\n```\n([^\n]*)}}/g;
		const anySCRegex = /```smart-connections\n([\s\S]*?)\n```/;

		if (!anySCRegex.test(content)) {
			return content;
		}

		// This is what we're trying to access: !this.cannoli.app.plugins.plugins["smart-connections"].api
		// We need to try to access it in a way that doesn't throw an error if the plugin isn't found
		try {
			// @ts-ignore - This is a private API
			if (!this.cannoli.app.plugins.plugins["smart-connections"].api) {
				console.error("Smart Connections plugin not found");
				return content;
			}
		} catch (error) {
			return content;
		}

		// Handle embedded dataview queries

		let embedMatch;
		const embedMatches = [];
		// Extract all matches first
		while ((embedMatch = embedRegex.exec(content)) !== null) {
			embedMatches.push({
				fullMatch: embedMatch[0],
				limit: embedMatch[1],
				query: embedMatch[2],
				modifiers: embedMatch[3],
				index: embedMatch.index
			});
		}

		// Reverse the matches array to process from last to first
		embedMatches.reverse();

		// Process each match asynchronously
		for (const match of embedMatches) {
			let includeName = false;
			let includeProperties = false;
			let includeLink = false;

			if (match.modifiers.includes('!#')) {
				includeName = false;
			} else if (match.modifiers.includes('#')) {
				includeName = true;
			} else {
				includeName = this.cannoli.settings.includeFilenameAsHeader;
			}

			if (match.modifiers.includes('!^')) {
				includeProperties = false;
			} else if (match.modifiers.includes('^')) {
				includeProperties = true;
			} else {
				includeProperties = this.cannoli.settings.includePropertiesInExtractedNotes;
			}

			if (match.modifiers.includes('!@')) {
				includeLink = false;
			} else if (match.modifiers.includes('@')) {
				includeLink = true;
			} else {
				includeLink = this.cannoli.settings.includeLinkInExtractedNotes;
			}

			// @ts-ignore - This is a private API
			let result = await this.cannoli.app.plugins.plugins["smart-connections"].api.search(match.query);

			// If there's no limit defined, use the default limit of 5. If the limit is defined, parse it as an integer and truncate the results array
			const limit = match.limit ? parseInt(match.limit) : 5;

			if (result.length > limit) {
				result = result.slice(0, limit);
			}

			// Build the replacement string by retrieving the note content for each result and concatenating them with a newline
			let resultLinksReplaced = "";
			for (const r of result) {
				let noteName = r.path;
				let subpath;

				// If there's a "#" in the path, split and use the first part as the note name, and the second part as the heading
				if (noteName.includes("#")) {
					const split = noteName.split("#");
					noteName = split[0];
					subpath = split[1];
				}

				const reference = {
					name: noteName,
					type: ReferenceType.Note,
					shouldExtract: true,
					includeName: includeName,
					includeProperties: includeProperties,
					includeLink: includeLink,
					subpath: subpath ?? undefined
				};

				const noteContent = await this.getNote(reference, isMock);

				resultLinksReplaced += noteContent + "\n";
			}

			// Replace the original text with the result
			content = content.substring(0, match.index) + resultLinksReplaced + content.substring(match.index + match.fullMatch.length);
		}

		// Handle normal dataview queries
		let nonEmbedMatch;
		const nonEmbedMatches = [];

		while ((nonEmbedMatch = nonEmbedRegex.exec(content)) !== null) {
			nonEmbedMatches.push({
				fullMatch: nonEmbedMatch[0],
				query: nonEmbedMatch[1],
				index: nonEmbedMatch.index
			});
		}

		// Reverse the matches array to process from last to first
		nonEmbedMatches.reverse();

		// Process each match asynchronously
		for (const match of nonEmbedMatches) {
			// @ts-ignore - This is a private API
			const results = await this.cannoli.app.plugins.plugins["smart-connections"].api.search(match.query);

			// Build a markdown table of with the columns "Similarity" (results[0].sim) and "Link" (results[i].path)
			let result = "| Similarity | Link |\n| --- | --- |\n";

			// @ts-ignore - This is a private API
			results.forEach((r) => {
				if (typeof r === "object" && r.sim && r.path) {
					result += `| ${r.sim.toFixed(2)} | [[${r.path}]] |\n`;
				}
			});

			// const result = queryResult.successful ? queryResult.value : "Invalid Dataview query";

			// Replace the original text with the result
			content = content.substring(0, match.index) + result + content.substring(match.index + match.fullMatch.length);
		}

		return content;

	}

	async querySmartConnections(query: string, limit: number): Promise<string[]> {
		// @ts-ignore - This is a private API
		const results = await this.cannoli.app.plugins.plugins["smart-connections"].api.search(query);

		return results.slice(0, limit).map((r: { path: string }) => {
			let path = r.path;

			// Remove the trailing "#" if it exists
			if (path.endsWith("#")) {
				path = path.slice(0, -1);
			}

			// Extract the filename from the path
			const filename = path.substring(path.lastIndexOf("/") + 1);

			return `[[${filename}]]`;
		});
	}

	async extractNoteContents(
		noteLinks: string[],
		includeName: boolean,
		includeProperties: boolean,
		includeLink: boolean,
		isMock: boolean,
		allowSubpaths: boolean = true
	): Promise<string[]> {
		const resultContents = [];
		for (const noteLink of noteLinks) {
			// Get rid of the double brackets
			const cleanedLink = noteLink.replace("[[", "").replace("]]", "");

			const [noteName, subpath] = cleanedLink.split("#");

			const reference: Reference = {
				name: noteName,
				type: ReferenceType.Note,
				shouldExtract: true,
				includeName,
				includeProperties,
				includeLink,
				subpath: allowSubpaths ? subpath ?? undefined : undefined
			};

			const noteContent = await this.getNote(reference, isMock);

			if (noteContent) {
				resultContents.push(noteContent);
			}
		}
		return resultContents;
	}

	// Attempting to replace dataviewjs queries
	// const dataviewsjs = newContent.match(
	// 	/```dataviewjs\n([\s\S]*?)\n```/g
	// );
	// if (dvApi && dataviewsjs && dataviewsjs.length) {
	// 	for (const dataview of dataviewsjs) {
	// 		const sanitizedQuery = dataview.replace("```dataviewjs", "").replace("```", "").trim()

	// 		console.log(sanitizedQuery)

	// 		// Make an empty HTML element to render the dataview output
	// 		const dvOutput = createEl("div");

	// 		// Make an empty/fake component to render the dataview output
	// 		const dvComponent = new Component();

	// 		dvComponent.onload = () => {
	// 			// Do nothing
	// 		}

	// 		const dvContent = await dvApi.executeJs(sanitizedQuery, dvOutput, dvComponent, "")

	// 		newContent = newContent.replace(dataview, dvOutput.innerHTML)

	// 		console.log(dvOutput.innerHTML)
	// 	}
	// }

	editSelection(newContent: string, isMock: boolean) {
		if (isMock) {
			return;
		}

		if (!this.cannoli.app.workspace.activeEditor) {
			return;
		}

		this.cannoli.app.workspace.activeEditor?.editor?.replaceSelection(
			newContent
		);
	}

	async getPropertyOfNote(
		noteName: string,
		propertyName: string,
		yamlFormat = false
	): Promise<string | null> {
		// Get the file
		const filename = noteName.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return null;
		}

		try {
			// Read the file to get the frontmatter
			let frontmatter: Record<string, unknown> = {};
			await this.cannoli.app.fileManager.processFrontMatter(
				file,
				(content) => {
					frontmatter = content;
					return content;
				}
			);

			// If frontmatter is null or undefined, return null
			if (!frontmatter) {
				return null;
			}

			const property = frontmatter[propertyName];

			if (typeof property !== "string") {
				if (yamlFormat) {
					return yaml.dump(property);
				} else {
					return JSON.stringify(frontmatter[propertyName], null, 2);
				}
			} else {
				return property;
			}
		} catch (error) {
			console.error(
				"An error occurred while fetching frontmatter:",
				error
			);
			return null;
		}
	}

	async getAllPropertiesOfNote(
		noteName: string,
		yamlFormat = false
	): Promise<string | null> {
		// Get the file
		const filename = noteName.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return null;
		}

		try {
			// Read the file to get the frontmatter
			let frontmatter: Record<string, unknown> = {};
			await this.cannoli.app.fileManager.processFrontMatter(
				file,
				(content) => {
					frontmatter = content;
					return content;
				}
			);

			// If frontmatter is null or undefined, return null
			if (!frontmatter) {
				return null;
			}

			if (!yamlFormat) {
				return JSON.stringify(frontmatter, null, 2);
			} else {
				return yaml.dump(frontmatter);
			}
		} catch (error) {
			console.error(
				"An error occurred while fetching frontmatter:",
				error
			);
			return null;
		}
	}

	async editPropertyOfNote(
		noteName: string,
		propertyName: string,
		newValue: string
	): Promise<void> {
		// Get the file
		const filename = noteName.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return;
		}

		let parsedNewValue: string[] | string | number | boolean | null =
			newValue;

		// If the new value is a yaml list (starts with "- "), parse it into an array and remove any empty items
		if (newValue.startsWith("- ")) {
			parsedNewValue = newValue
				.split("\n")
				.map((item) => item.replace("- ", "").trim())
				.filter((item) => item !== "");
		}

		try {
			await this.cannoli.app.fileManager.processFrontMatter(
				file,
				(content) => {
					// Parse the frontmatter
					let frontmatter: Record<string, unknown> = {};

					if (content) {
						frontmatter = content;
					}

					// Set the property
					frontmatter[propertyName] = parsedNewValue;

					// Write the frontmatter
					return frontmatter;
				}
			);
			return;
		} catch (error) {
			console.error(
				"An error occurred while editing frontmatter:",
				error
			);
			return;
		}
	}

	async createNoteAtExistingPath(
		noteName: string,
		path?: string,
		content?: string,
		verbose = false
	): Promise<string | null> {
		// If there are double brackets, remove them
		noteName = noteName.replace("[[", "").replace("]]", "");

		// Attempt to create the note, adding or incrementing a number at the end of the note name if it already exists
		let i = 1;

		while (
			this.cannoli.app.metadataCache.getFirstLinkpathDest(noteName, "")
		) {
			// If the note name ends with " n", remove the " n" and increment n
			if (noteName.match(/ \d+$/)) {
				noteName = noteName.replace(/ \d+$/, ` ${i.toString()}`);
			} else {
				noteName = `${noteName} ${i.toString()}`;
			}
			i++;
		}

		// Create the path by appending the note name to the path with .md
		const fullPath = `${path ?? ""}/${noteName}.md`;

		// Create the note
		await this.cannoli.app.vault.create(fullPath, content ?? "");

		if (verbose) {
			console.log(`Note "${noteName}" created at path "${fullPath}"`);
		}

		return noteName;
	}

	async createNoteAtNewPath(
		noteName: string,
		path: string,
		content?: string,
		verbose = false
	): Promise<boolean> {
		// Create the path by appending the note name to the path with .md
		const fullPath = `${path}/${noteName}.md`;

		// Create the note
		await this.cannoli.app.vault.create(fullPath, content ?? "");

		if (verbose) {
			console.log(`Note "${noteName}" created at path "${fullPath}"`);
		}

		return true;
	}

	async getNotePath(noteName: string): Promise<string | null> {
		const filename = noteName.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return null;
		}

		return file.path;
	}

	async createFolder(path: string, verbose = false): Promise<boolean> {
		// Check if the path already exists
		const folder = this.cannoli.app.vault.getAbstractFileByPath(path);

		if (folder) {
			return false;
		}

		// Create the folder
		this.cannoli.app.vault.createFolder(path);

		if (verbose) {
			console.log(`Folder created at path "${path}"`);
		}

		return true;
	}

	async moveNote(
		noteName: string,
		newPath: string,
		verbose = false
	): Promise<boolean> {
		// Create the path by appending the note name to the paths with .md
		const newFullPath = `${newPath}/${noteName}.md`;

		const filename = noteName.replace("[[", "").replace("]]", "");
		const note = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		// Get the old path
		const oldFullPath = note?.path;

		if (!note) {
			return false;
		}

		// Move the note
		await this.cannoli.app.vault.rename(note, newFullPath);

		if (verbose) {
			console.log(
				`Note "${noteName}" moved from path "${oldFullPath}" to path "${newFullPath}"`
			);
		}

		return true;
	}


	openCustomModal(layout: string): Promise<string | Error> {
		return new Promise((resolve) => {
			try {
				const lines = layout.split('\n');
				let title = "Cannoli modal";
				let fixedLayout = layout;

				if (lines.length > 0 && !lines[0].includes('==')) {
					title = lines[0].trim().replace(/^#+\s*/, '');
					fixedLayout = lines.slice(1).join('\n');
				}

				new CustomModal(this.cannoli.app, fixedLayout, (result) => {
					if (result instanceof Error) {
						resolve(result);
					} else {
						resolve(JSON.stringify(result, null, 2));
					}
				}, title).open();
			} catch (error) {
				resolve(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}
}

interface ModalComponent {
	type: 'text' | 'input';
	content: string;
	name: string;
	fieldType: string;
	options?: string[];
	format: string;
}

interface ModalParagraph {
	components: ModalComponent[];
}

class CustomModal extends Modal {
	layout: string;
	callback: (result: Record<string, string> | Error) => void;
	title: string;
	paragraphs: ModalParagraph[];
	isSubmitted: boolean;
	values: Record<string, string>;

	constructor(app: App, layout: string, callback: (result: Record<string, string> | Error) => void, title: string) {
		super(app);
		this.layout = layout;
		this.callback = callback;
		this.title = title;
		this.paragraphs = this.parseLayout();
		this.isSubmitted = false;
		this.values = {};
	}

	parseLayout(): ModalParagraph[] {
		const regex = /(\s*)==([\s\S]+?)==|([^=]+)/g;
		const paragraphs: ModalParagraph[] = [{ components: [] }];
		let match;

		while ((match = regex.exec(this.layout)) !== null) {
			if (match[2]) { // Input component
				const trimmedContent = match[2].trim();
				let fieldContent: string | string[];

				// Check if content is a JSON array
				if (trimmedContent.startsWith('[') && trimmedContent.endsWith(']')) {
					try {
						// Attempt to parse as JSON, handling potential escaping issues
						fieldContent = JSON.parse(trimmedContent.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
					} catch (e) {
						console.error('Failed to parse JSON options:', e);
						// If parsing fails, treat it as a comma-separated list
						fieldContent = trimmedContent.slice(1, -1).split(',').map(item =>
							item.trim().replace(/^["']|["']$/g, '') // Remove surrounding quotes if present
						);
					}
				} else {
					fieldContent = trimmedContent;
				}

				let fieldName: string, fieldType: string, options: string[] | undefined;

				if (Array.isArray(fieldContent)) {
					// If fieldContent is an array, assume the first element is the field name and type
					const [nameAndType, ...rest] = fieldContent;
					[fieldName, fieldType] = this.parseNameAndType(nameAndType as string);
					options = rest.map(String);
				} else {
					// If fieldContent is a string, use parseField as before
					[fieldName, fieldType, options] = this.parseField(fieldContent);
				}

				const format = this.parseField(Array.isArray(fieldContent) ? fieldContent[0] : fieldContent)[3] ||
					(fieldType === 'date' ? 'YYYY-MM-DD' :
						fieldType === 'time' ? 'HH:mm' :
							fieldType === 'datetime' ? 'YYYY-MM-DDTHH:mm' : '');

				if (match[1]) { // Preserve leading whitespace
					paragraphs[paragraphs.length - 1].components.push({
						type: 'text',
						content: match[1],
						name: "",
						fieldType: "text",
						format: format
					});
				}
				paragraphs[paragraphs.length - 1].components.push({
					type: 'input',
					content: fieldName,
					name: fieldName,
					fieldType: fieldType,
					options: options,
					format: format
				});
			} else if (match[3]) { // Text component
				const textParts = match[3].split('\n');
				textParts.forEach((part, index) => {
					if (index > 0) {
						paragraphs.push({ components: [] });
					}
					paragraphs[paragraphs.length - 1].components.push({
						type: 'text',
						content: part,
						name: "",
						fieldType: "text",
						format: ""
					});
				});
			}
		}

		return paragraphs;
	}

	parseField(field: string): [string, string, string[] | undefined, string | undefined] {
		// Remove double equals signs
		const content = field.trim();

		// Find the index of the first opening parenthesis
		const openParenIndex = content.indexOf('(');

		let name: string;
		let type: string = 'text';  // Default type
		let optionsString: string = '';
		let format: string | undefined;

		if (openParenIndex === -1) {
			// No parentheses found, everything is the name
			name = content;
		} else {
			// Find the matching closing parenthesis
			const closeParenIndex = content.indexOf(')', openParenIndex);
			if (closeParenIndex === -1) {
				// Mismatched parentheses, treat everything as name
				name = content;
			} else {
				name = content.slice(0, openParenIndex).trim();
				type = content.slice(openParenIndex + 1, closeParenIndex).trim();
				const remainingContent = content.slice(closeParenIndex + 1).trim();

				// Check if there's content after the type declaration
				if (remainingContent) {
					if (type === 'date' || type === 'time' || type === 'datetime') {
						format = remainingContent;
					} else {
						optionsString = remainingContent;
					}
				}
			}
		}

		// Parse options if present
		let options: string[] | undefined;
		if (optionsString.startsWith('[') && optionsString.endsWith(']')) {
			try {
				// Attempt to parse as JSON, handling potential escaping issues
				options = JSON.parse(optionsString.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
			} catch (e) {
				// If parsing fails, treat it as a comma-separated list
				options = optionsString.slice(1, -1).split(',').map(item =>
					item.trim().replace(/^["']|["']$/g, '') // Remove surrounding quotes if present
				);
			}

			// Ensure options is an array of strings
			if (Array.isArray(options)) {
				options = options.flat().map(String);
			} else {
				options = [String(options)];
			}
		} else {
			options = optionsString ? optionsString.split(',').map(o => o.trim()).filter(o => o !== '') : undefined;
		}

		return [name, type, options, format];
	}

	parseNameAndType(content: string): [string, string] {
		// Remove any leading or trailing whitespace
		content = content.trim();

		// Find the index of the last opening parenthesis
		const openParenIndex = content.lastIndexOf('(');

		if (openParenIndex === -1) {
			// If there's no parenthesis, assume it's all name and type is default
			return [content, 'text'];
		}

		// Find the matching closing parenthesis
		const closeParenIndex = content.indexOf(')', openParenIndex);

		if (closeParenIndex === -1) {
			// If there's no closing parenthesis, assume it's all name
			return [content, 'text'];
		}

		// Extract the name (everything before the last opening parenthesis)
		const name = content.slice(0, openParenIndex).trim();

		// Extract the type (everything between the parentheses)
		const type = content.slice(openParenIndex + 1, closeParenIndex).trim();

		return [name, type || 'text'];
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h1", { text: this.title });
		const form = contentEl.createEl("form");
		form.onsubmit = (e) => {
			e.preventDefault();
			this.handleSubmit();
		};

		this.paragraphs.forEach(paragraph => {
			const p = form.createEl("p");
			paragraph.components.forEach(component => {
				if (component.type === 'text') {
					p.appendText(component.content);
				} else {
					this.createInputComponent(p, component);
				}
			});
		});

		form.createEl("button", { text: "Submit", type: "submit" });
		this.addStyle();
		this.modalEl.addClass('cannoli-modal');
	}

	addStyle() {
		const style = document.createElement('style');
		style.textContent = `
            .cannoli-modal .modal-content p {
                white-space: pre-wrap;
            }
            .cannoli-modal .obsidian-style-time-input {
                background-color: var(--background-modifier-form-field);
                border: 1px solid var(--background-modifier-border);
                color: var(--text-normal);
                padding: var(--size-4-1) var(--size-4-2);
                border-radius: var(--radius-s);
                font-size: var(--font-ui-small);
                line-height: var(--line-height-tight);
                width: auto;
                font-family: var(--font-interface);
                position: relative;
            }
            .cannoli-modal .obsidian-style-time-input:focus {
                outline: none;
                box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
            }
            .cannoli-modal .obsidian-style-time-input:hover {
                background-color: var(--background-modifier-form-field-hover);
            }
        `;
		document.head.appendChild(style);
	}

	createInputComponent(paragraph: HTMLParagraphElement, component: ModalComponent) {
		let settingComponent;

		const updateValue = (value: string) => {
			if (component.fieldType === 'date') {
				const formattedValue = moment(value, 'YYYY-MM-DD').format(component.format);
				this.values[component.name] = formattedValue;
			} else if (component.fieldType === 'time') {
				const formattedValue = moment(value, 'HH:mm').format(component.format || 'HH:mm');
				this.values[component.name] = formattedValue;
			} else if (component.fieldType === 'datetime') {
				const formattedValue = moment(value, 'YYYY-MM-DDTHH:mm').format(component.format || 'YYYY-MM-DDTHH:mm');
				this.values[component.name] = formattedValue;
			} else {
				this.values[component.name] = value;
			}
		};

		switch (component.fieldType) {
			case 'textarea':
				settingComponent = new TextAreaComponent(paragraph)
					.setPlaceholder(component.content)
					.onChange(updateValue);
				updateValue('');
				break;
			case 'toggle': {
				const toggleContainer = paragraph.createSpan({ cls: 'toggle-container' });
				settingComponent = new ToggleComponent(toggleContainer)
					.setValue(false)
					.onChange(value => updateValue(value ? "true" : "false"));
				updateValue("false");
				break;
			}
			case 'dropdown':
				if (component.options && component.options.length > 0) {
					settingComponent = new DropdownComponent(paragraph)
						.addOptions(Object.fromEntries(component.options.map(opt => [opt, opt])))
						.onChange(updateValue);
					updateValue(component.options[0]);
				}
				break;
			case 'date': {
				settingComponent = new TextComponent(paragraph)
					.setPlaceholder(component.content)
					.onChange((value) => {
						updateValue(value);
					});
				settingComponent.inputEl.type = 'date';
				const defaultDate = moment().format(component.format);
				settingComponent.inputEl.value = moment(defaultDate, component.format).format('YYYY-MM-DD');
				updateValue(settingComponent.inputEl.value);
				break;
			}
			case 'time': {
				settingComponent = new TextComponent(paragraph)
					.setPlaceholder(component.content)
					.onChange((value) => {
						updateValue(value);
					});
				settingComponent.inputEl.type = 'time';
				const defaultTime = moment().format('HH:mm');
				settingComponent.inputEl.value = defaultTime;
				updateValue(settingComponent.inputEl.value);

				// Add custom styling to the time input
				settingComponent.inputEl.addClass('obsidian-style-time-input');
				break;
			}
			case 'datetime': {
				settingComponent = new TextComponent(paragraph)
					.setPlaceholder(component.content)
					.onChange((value) => {
						updateValue(value);
					});
				settingComponent.inputEl.type = 'datetime-local';
				const defaultDateTime = moment().format(component.format);
				settingComponent.inputEl.value = defaultDateTime;
				updateValue(settingComponent.inputEl.value);
				break;
			}
			case 'text':
			case '':
			case undefined:
			default:
				settingComponent = new TextComponent(paragraph)
					.setPlaceholder(component.content)
					.onChange(updateValue);
				updateValue('');
				break;

		}

		if (settingComponent) {
			if (settingComponent instanceof ToggleComponent) {
				settingComponent.toggleEl.setAttribute('data-name', component.name);
				settingComponent.toggleEl.setAttribute('aria-label', component.content);
			} else if ('inputEl' in settingComponent) {
				settingComponent.inputEl.name = component.name;
				settingComponent.inputEl.setAttribute('aria-label', component.content);
			}
		}

		// Add custom CSS to align the toggle
		const style = document.createElement('style');
		style.textContent = `
            .toggle-container {
                display: inline-flex;
                align-items: center;
                vertical-align: middle;
                margin-left: 4px;
            }
            .toggle-container .checkbox-container {
                margin: 0;
            }
        `;
		document.head.appendChild(style);
	}

	onClose() {
		if (!this.isSubmitted) {
			this.callback(new Error("Modal closed without submission"));
		}
	}

	handleSubmit() {
		const result = { ...this.values };

		this.paragraphs.forEach(paragraph => {
			paragraph.components.forEach(component => {
				if (component.type === 'input') {
					if (!(component.name in result) ||
						((component.fieldType === 'text' || component.fieldType === 'textarea') && result[component.name].trim() === '')) {
						result[component.name] = "No input";
					}
				}
			});
		});

		this.isSubmitted = true;
		this.close();
		this.callback(result);
	}
}
