const fs = require("fs");
const path = require("path");

// Path to the directory containing the subfolders you want to parse
const inputDirectory = "./Cannoli College";

// Path to the generated JavaScript file
const outputFile = "./cannoliCollege.js";

let cannoliCollegeContent = "export const cannoliCollege = {\n";

fs.readdir(inputDirectory, (err, folders) => {
	if (err) {
		console.error(`Error reading the directory: ${err}`);
		return;
	}

	folders.forEach((folder, index) => {
		const folderPath = path.join(inputDirectory, folder);

		// Check if the folderPath is a directory
		if (!fs.statSync(folderPath).isDirectory()) {
			return; // Skip this item if it's not a directory
		}

		let filesContent = "";

		fs.readdirSync(folderPath).forEach((file) => {
			const filePath = path.join(folderPath, file);
			let fileContent = fs.readFileSync(filePath, "utf8");

			// If it's a .canvas file, parse and stringify it
			if (file.endsWith(".canvas")) {
				fileContent = JSON.stringify(JSON.parse(fileContent));
			}

			// Stringify the content again to safely escape any special characters
			fileContent = JSON.stringify(fileContent);

			filesContent += `
        {
            name: "${file}",
            content: ${fileContent}
        },`;
		});

		cannoliCollegeContent += `  "${folder}": [${filesContent}\n],\n`;
	});

	cannoliCollegeContent += "};\n";

	fs.writeFileSync(outputFile, cannoliCollegeContent);
	console.log(`File generated successfully at ${outputFile}!`);
});
