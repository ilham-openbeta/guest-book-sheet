const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { xss } = require("express-xss-sanitizer");
const { GoogleAuth } = require("google-auth-library");
const { google } = require("googleapis");
const compression = require("compression");
const helmet = require("helmet");
const RateLimit = require("express-rate-limit");
require("dotenv").config();
const axios = require("axios");

// load the environment variable
var keysEnvVar = process.env["GOOGLE_SERVICE_ACCOUNT"];
if (!keysEnvVar) {
  throw new Error(
    "The $GOOGLE_SERVICE_ACCOUNT environment variable was not found!"
  );
}
keysEnvVar = Buffer.from(
  process.env["GOOGLE_SERVICE_ACCOUNT"],
  "base64"
).toString("utf-8");

const spreadsheetId = process.env["SPREADSHEET_ID"];
if (!spreadsheetId) {
  throw new Error("The $SPREADSHEET_ID environment variable was not found!");
}

const sheetName = process.env["DATA_RANGE"];
if (!sheetName) {
  throw new Error("The $DATA_RANGE environment variable was not found!");
}

const corsAllowed = process.env["CORS_ALLOWED_ORIGIN"];
if (!corsAllowed) {
  throw new Error(
    "The $CORS_ALLOWED_ORIGIN environment variable was not found!"
  );
}

const port = process.env["SERVER_PORT"];
if (!port) {
  throw new Error("The $SERVER_PORT environment variable was not found!");
}

const rrSpreadsheetId = process.env["RR_SPREADSHEET_ID"];
if (!rrSpreadsheetId) {
  throw new Error("The $RR_SPREADSHEET_ID environment variable was not found!");
}

const rrSheetName = process.env["RR_SHEET_ID"];
if (!rrSheetName) {
  throw new Error("The $RR_SHEET_ID environment variable was not found!");
}

const rrSheetRange = process.env["RR_DATA_RANGE"];
if (!rrSheetRange) {
  throw new Error("The $RR_DATA_RANGE environment variable was not found!");
}

const app = express();

const corsOption = {
  origin: corsAllowed.trim().split(/\s*,\s*/),
};

const limiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
});

app.use(compression());
app.use(helmet());
app.use(limiter);
app.use(cors(corsOption));
app.use(
  bodyParser.urlencoded({
    extended: true,
    limit: "99kb",
  })
);
app.use(xss());

const recordLimit = bodyParser.json({
  limit: "999kb",
});
const generalLimit = bodyParser.json({
  limit: "99kb",
});
app.use((req, res, next) => {
  if (req.path == "/record") {
    recordLimit(req, res, next);
  } else {
    generalLimit(req, res, next);
  }
});

// create credetial object
const serviceaccountauth = new GoogleAuth({
  credentials: JSON.parse(keysEnvVar),
  // keyFile: './service-account.json',
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// set default google credential
google.options({
  auth: serviceaccountauth,
});

const sheets = google.sheets("v4");

const formatedTimestamp = () => {
  const d = new Date();
  const date = d.toISOString().split("T")[0];
  const time = d.toTimeString().split(" ")[0];
  return `${date} ${time}`;
};

app.get("/", function (req, res) {
  res.send("nothing here");
});

app.get("/get-message", async (req, res) => {
  let messages = [];
  try {
    let sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: sheetName,
    });

    for (let row of sheetResponse.data.values) {
      messages.push({
        name: row[1],
        message: row[2],
        createdAt: row[4],
      });
    }
  } catch (sheetError) {
    console.log("Get sheet error : " + sheetError);
  }

  res.send(messages);
});

app.post("/send-message", async (req, res) => {
  let status = req.body.status == "Hadir" ? "Hadir" : "Tidak Hadir";
  try {
    let sheetResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: sheetName,
      valueInputOption: "RAW",
      requestBody: {
        values: [
          [
            req.body.contact,
            req.body.name || "Anonymous",
            req.body.message,
            status,
            formatedTimestamp(),
          ],
        ],
      },
    });
    res.send({
      status: "ok",
    });
  } catch (sheetError) {
    console.log("Append sheet error : " + sheetError);
    res.send({
      status: "failed",
    });
  }
});

const maxChar = 30000;

function splitString(str) {
  var chunks = [];

  for (var i = 0, charsLength = str.length; i < charsLength; i += maxChar) {
    chunks.push(str.substring(i, i + maxChar));
  }
  return chunks;
}

app.post("/record", async (req, res) => {
  if (req.body.id == null) {
    return res.send({
      status: "failed",
      message: "ID is null",
    });
  } else if (req.body.events == null) {
    return res.send({
      status: "failed",
      message: "Events is null",
    });
  }

  try {
    let sheetPayload = [];
    req.body.events.forEach((element) => {
      // copy orderId then remove 
      let orderId = element.orderId 
      delete element.orderId 
      // split event data because too big for a cell in spreadsheet
      let splittedString = splitString(JSON.stringify(element));
      sheetPayload.push([
        req.body.id,
        req.body.to,
        splittedString[0],
        splittedString[1],
        splittedString[2],
        splittedString[3],
        splittedString[4],
        orderId
      ]);
    });

    let sheetResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: rrSpreadsheetId,
      range: rrSheetName + "!" + rrSheetRange,
      valueInputOption: "RAW",
      requestBody: {
        values: sheetPayload,
      },
    });
    res.send({
      status: "ok",
    });
  } catch (sheetError) {
    console.log("Append sheet error : " + sheetError);
    res.send({
      status: "failed",
    });
  }
});

async function getFilteredSheet(id) {
  // https://developers.google.com/chart/interactive/docs/dev/implementing_data_source#security-considerations
  // https://stackoverflow.com/questions/57719239/how-can-i-use-the-google-sheets-v4-api-getbydatafilter-to-return-a-specific-ro
  // https://stackoverflow.com/questions/31765773/converting-google-visualization-query-result-into-javascript-array/64377070#64377070
  const accessToken = await serviceaccountauth.getAccessToken();
  const query = `select * where A='${id}' order by H`;
  const vizParam = "out:json";

  let url = `https://docs.google.com/spreadsheets/d/${rrSpreadsheetId}/gviz/tq?gid=${rrSheetName}&tqx=${vizParam}&range=${rrSheetRange}&headers=0&tq=${query}&access_token=${accessToken}`;

  let googleJSONPResponse = await axios.get(url);
  // remove jsonp callback text
  let regexp = /(?<=.*\().*(?=\);)/s;
  let googleJsonResponse = JSON.parse(regexp.exec(googleJSONPResponse.data)[0]);

  let formattedResponse = [];
  googleJsonResponse.table.rows.forEach(function (row) {
    let rowArray = [];
    row.c.forEach(function (prop) {
      rowArray.push(prop?.v);
    });
    formattedResponse.push(rowArray);
  });

  return formattedResponse;
}

app.get("/record", async function (req, res) {
  if (req.query.id == null) return res.send("Failed");

  let sheetResponse = await getFilteredSheet(req.query.id);

  let events = [];
  for (let row of sheetResponse) {
    // concat event part
    let concatEvent =
      (row[2] ?? "") +
      (row[3] ?? "") +
      (row[4] ?? "") +
      (row[5] ?? "") +
      (row[6] ?? "");
    events.push(JSON.parse(concatEvent));
  }

  res.send({
    events: events,
  });
});

// test API rate limit, makesure ip response match with your ip 
app.get('/ip', (request, response) => response.send(request.ip))
app.set('trust proxy', 1)

app.listen(port, () => {
  console.log(`Guest Book app listening on port ${port}`);
});
