export function parseNamedNode(content: string): {
  name: string | null;
  content: string;
} {
  const lines = content.split("\n");
  const firstLine = lines[0].trim();

  // Check if the first line is a single-bracketed name
  if (
    firstLine.startsWith("[") &&
    firstLine.endsWith("]") &&
    !firstLine.startsWith("[[")
  ) {
    // Try to parse as JSON to ensure it's not a valid JSON array
    try {
      JSON.parse(firstLine);
      // If it's a valid JSON array, don't treat it as a name
      return { name: null, content };
    } catch {
      // Not a valid JSON array, so it's a name
      const name = firstLine.slice(1, -1);
      const remainingContent = lines.slice(1).join("\n");
      return { name, content: remainingContent };
    }
  }

  // If not a single-bracketed name, return null for name and the entire content
  return { name: null, content };
}

export function safeKeyName(key: string) {
  return key.replace(/[^a-zA-Z0-9]/g, "_");
}
