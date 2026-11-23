// Regular Netlify Function (60 s limit): the whole Express app.
const serverless = require("serverless-http");
const { connectLambda } = require("@netlify/blobs");
const app = require("../../server/app");

const handler = serverless(app, {
  binary: ["application/zip", "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"],
});

exports.handler = async (event, context) => {
  connectLambda(event); // gives Netlify Blobs its credentials inside this function
  return handler(event, context);
};
