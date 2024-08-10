const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser');
const {
  xss
} = require('express-xss-sanitizer');
const {
  GoogleAuth
} = require('google-auth-library');
const {
  google
} = require('googleapis');

// load the environment variable 
const keysEnvVar = process.env['GOOGLE_SERVICE_ACCOUNT'];
if (!keysEnvVar) {
  throw new Error('The $GOOGLE_SERVICE_ACCOUNT environment variable was not found!');
}

const spreadsheetId = process.env['SPREADSHEET_ID'];
if (!spreadsheetId) {
  throw new Error('The $SPREADSHEET_ID environment variable was not found!');
}

const sheetName = process.env['DATA_RANGE'];
if (!sheetName) {
  throw new Error('The $DATA_RANGE environment variable was not found!');
}

const corsAllowed = process.env['CORS_ALLOWED_ORIGIN'];
if (!corsAllowed) {
  throw new Error('The $CORS_ALLOWED_ORIGIN environment variable was not found!');
}

const port = process.env['SERVER_PORT'];
if (!port) {
  throw new Error('The $SERVER_PORT environment variable was not found!');
}


const app = express()

const corsOption = {
  origin: corsAllowed.trim().split(/\s*,\s*/)
}

app.use(cors(corsOption))
app.use(bodyParser.json({
  limit: '99kb'
}));
app.use(bodyParser.urlencoded({
  extended: true,
  limit: '99kb'
}));
app.use(xss());



// create credetial object
const serviceaccountauth = new GoogleAuth({
  credentials: JSON.parse(keysEnvVar),
  // keyFile: './service-account.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

// set default google credential
google.options({
  auth: serviceaccountauth
});

const sheets = google.sheets('v4');

const formatedTimestamp = () => {
  const d = new Date()
  const date = d.toISOString().split('T')[0];
  const time = d.toTimeString().split(' ')[0];
  return `${date} ${time}`
}



app.get('/get-message', async (req, res) => {
  let messages = []
  try {
    let sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: sheetName
    })

    for (let row of sheetResponse.data.values) {
      messages.push({
        name: row[1],
        message: row[2],
        createdAt: row[4]
      })
    }
  } catch (sheetError) {
    console.log("Get sheet error : " + sheetError)
  }

  res.send(messages)
})

app.post('/send-message', async (req, res) => {
  let status = req.body.status == "Hadir" ? "Hadir" : "Tidak Hadir"; 
  try {
    let sheetResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: sheetName,
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          [req.body.contact, req.body.name || "Anonymous", req.body.message, status, formatedTimestamp()]
        ]
      },
    });
    res.send("ok")
  } catch (sheetError) {
    console.log("Append sheet error : " + sheetError)
    res.send('failed')
  }
})


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})