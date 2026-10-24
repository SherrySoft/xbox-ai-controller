/**
 * Programmatic Quickstart Example
 * Demonstrates using xbox-ai-controller as a Node.js library
 */

const { discover, powerOn, launchByProductId, resolveAppOrGame, sendButton, loadConfig } = require("../src");

async function run() {
  console.log("1. Discovering console...");
  const discovery = await discover(3000);
  console.log("Found consoles:", discovery.consoles);

  const cfg = loadConfig();
  console.log("Target Xbox:", cfg.name, "at", cfg.ip);

  // 2. Launch a game by name
  const game = resolveAppOrGame("FC 25");
  console.log("Resolved game:", game);

  if (cfg.user_hash && cfg.xsts_token) {
    console.log("Launching game via Microsoft XCCS Cloud...");
    const res = await launchByProductId(game.productId);
    console.log("Launch response:", res);
  }

  // 3. Send a controller button press
  console.log("Opening Xbox Guide menu...");
  await sendButton("nexus");
  console.log("Done!");
}

run().catch(console.error);
