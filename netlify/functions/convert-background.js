// Background Function (the "-background" name makes Netlify allow up to 15 minutes).
// It can't reply with a result: it returns 202 at once, does the Claude step, and saves the HTML
// to Blobs. The web page polls GET /api/conversions/:id until the status changes.
const { connectLambda } = require("@netlify/blobs");
const { runConversion } = require("../../server/convert");
const { hmac, safeEqual } = require("../../server/util");

exports.handler = async (event) => {
  connectLambda(event);
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400 }; }

  // Only our own API function knows how to make this token, so strangers can't trigger conversions.
  if (!body.id || !body.token || !safeEqual(body.token, hmac("convert:" + body.id))) {
    return { statusCode: 403 };
  }
  await runConversion(body.id);
  return { statusCode: 200 };
};
