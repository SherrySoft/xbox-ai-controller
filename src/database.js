/**
 * Curated Xbox Game Database & Installed App Search Resolver
 */

const { loadInstalledApps } = require("./config");

const POPULAR_APPS = {
  // Football / FIFA
  "fc 25": { name: "EA SPORTS FC™ 25 Xbox One", productId: "9N436FQM30HX", titleId: "1882096658" },
  "fc25": { name: "EA SPORTS FC™ 25 Xbox One", productId: "9N436FQM30HX", titleId: "1882096658" },
  "ea sports fc 25": { name: "EA SPORTS FC™ 25 Xbox One", productId: "9N436FQM30HX", titleId: "1882096658" },
  "fifa": { name: "EA SPORTS FC™ 25 Xbox One", productId: "9N436FQM30HX", titleId: "1882096658" },

  // Top Games
  "minecraft": { name: "Minecraft", productId: "9MVXMVT8ZKWC", titleId: "1828326430" },
  "cricket 24": { name: "Cricket 24", productId: "9PPN49GPNH5M", titleId: "2128853757" },
  "cricket": { name: "Cricket 24", productId: "9PPN49GPNH5M", titleId: "2128853757" },
  "halo": { name: "Halo Infinite", productId: "9PP5G1F0C2B6", titleId: "1147234608" },
  "halo infinite": { name: "Halo Infinite", productId: "9PP5G1F0C2B6", titleId: "1147234608" },
  "asphalt": { name: "Asphalt Legends", productId: "9NZQPT0MWTD0", titleId: "1715349030" },
  "asphalt legends": { name: "Asphalt Legends", productId: "9NZQPT0MWTD0", titleId: "1715349030" },
  "war thunder": { name: "War Thunder", productId: "BX1DTCBD1HXJ", titleId: "1074129759" },
  "roblox": { name: "Roblox", productId: "9NBLGGGZM6WM", titleId: "495147517" },
  "fortnite": { name: "Fortnite", productId: "BT5P2X999VH2", titleId: "1282497678" },
  "gta": { name: "Grand Theft Auto V", productId: "9P5S26DC90KM", titleId: "1203590059" },
  "gta v": { name: "Grand Theft Auto V", productId: "9P5S26DC90KM", titleId: "1203590059" },

  // Media & Apps
  "youtube": { name: "YouTube", productId: "9P7W5LD3PBLZ", titleId: "1724294084" },
  "netflix": { name: "Netflix", productId: "9WZDNCRFJ3TJ", titleId: "327370029" },
  "spotify": { name: "Spotify", productId: "9NFQ49H668TB", titleId: "1665042407" },
  "twitch": { name: "Twitch", productId: "9WZDNCRFHNPD", titleId: "813893699" },
  "disney": { name: "Disney+", productId: "9NXQXX3CL2TS", titleId: "1749547743" },
  "disney+": { name: "Disney+", productId: "9NXQXX3CL2TS", titleId: "1749547743" },
  "apple tv": { name: "Apple TV", productId: "9P6WG5LLKM89", titleId: "1964177405" },
  "browser": { name: "Microsoft Edge", productId: "Microsoft.MicrosoftEdge_8wekyb3d8bbwe!App", titleId: "1675712128" },
  "edge": { name: "Microsoft Edge", productId: "Microsoft.MicrosoftEdge_8wekyb3d8bbwe!App", titleId: "1675712128" },
  "store": { name: "Microsoft Store", productId: "MicrosoftStore", titleId: "1864271209" },

  // System
  "settings": { name: "Settings", productId: "Settings", titleId: "1837352387" },
  "home": { name: "Home Dashboard", productId: "Dashboard", titleId: "750323071" },
  "dashboard": { name: "Home Dashboard", productId: "Dashboard", titleId: "750323071" },
};

/**
 * Resolves a game/app name to its ProductId by checking:
 * 1. Exact match in curated list
 * 2. Installed apps list on console (fuzzy / substring match)
 * 3. Fallback to raw string
 */
function resolveAppOrGame(query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();

  // 1. Curated match
  if (POPULAR_APPS[q]) {
    return POPULAR_APPS[q];
  }

  // 2. Search installed apps
  const installed = loadInstalledApps();
  if (installed && installed.length > 0) {
    const directMatch = installed.find((a) => a.name && a.name.toLowerCase() === q);
    if (directMatch) {
      return {
        name: directMatch.name,
        productId: directMatch.oneStoreProductId,
        titleId: directMatch.titleId,
      };
    }

    const partialMatch = installed.find((a) => a.name && a.name.toLowerCase().includes(q));
    if (partialMatch) {
      return {
        name: partialMatch.name,
        productId: partialMatch.oneStoreProductId,
        titleId: partialMatch.titleId,
      };
    }
  }

  // 3. Fallback
  return {
    name: query,
    productId: query,
    titleId: null,
  };
}

module.exports = {
  POPULAR_APPS,
  resolveAppOrGame,
};
