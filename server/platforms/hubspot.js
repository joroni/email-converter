// HubSpot rules (disabled until the move next year; an admin switches it on in Platform rules).
const { extractImageUrls } = require("./common");

module.exports = {
  id: "hubspot",
  label: "HubSpot",
  defaults: {
    enabled: false,
    unsubscribe: "{{ unsubscribe_link }}",
    mergeTags: ["{{ contact.firstname }}", "{{ contact.lastname }}", "{{ contact.company }}"],
    imageHost: "HubSpot File Manager",
  },
  extractImageUrls,
};
