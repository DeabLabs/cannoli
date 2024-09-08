import { Generator } from "./Generator";

export async function generateCannoli(prompt: string, apiKey: string): Promise<void> {
    // const recipe = await generateCannoliRecipe(prompt, apiKey);
    // console.log("generated recipe");
    // const canvas = convertRecipeStringToCanvasNoGeometry(recipe);
    // console.log("converted recipe to canvas");

    const generator = new Generator(prompt, apiKey);
    const recipe = await generator.generateCannoli();

    console.log("final recipe: ", recipe);

    return;
}

// export async function simulateLayout(canvas: SimCanvas, writeCallback: (jsonCanvas: JsonCanvas) => Promise<void>): Promise<void> {
//     const simulator = new LayoutSimulator(canvas, writeCallback);
//     await simulator.simulate();
// }

// export async function generateCannoliAndSimulateLayout(prompt: string, apiKey: string, writeCallback: (jsonCanvas: JsonCanvas) => Promise<void>): Promise<void> {
//     console.log("Prompt: ", prompt);
//     const canvas = await generateCannoli(prompt, apiKey);
//     await simulateLayout(canvas, writeCallback);
// }