// Pardot rules. To add or change a platform, copy this file and register it in ./index.js.
const { extractImageUrls } = require("./common");

module.exports = {
  id: "pardot",
  label: "Pardot",
  // Default rules; admins can edit these on the "Platform rules" page (stored in Blobs).
  defaults: {
    enabled: true,
    unsubscribe: "%%unsubscribe%%",
    mergeTags: ["%%first_name%%", "%%last_name%%", "%%company%%"],
    imageHost: "Pardot Files",
  },
  // How to find hosted image URLs in what the user pastes back (Pardot Files page HTML).
  extractImageUrls,
};
