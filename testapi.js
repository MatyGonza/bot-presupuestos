const https = require('https');
require('dotenv').config();

console.log("Checking API Key: ", process.env.GEMINI_API_KEY ? "EXISTS" : "MISSING");

const options = {
  hostname: 'generativelanguage.googleapis.com',
  path: '/v1beta/models?key=' + process.env.GEMINI_API_KEY,
  method: 'GET'
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', d => { data += d; });
  res.on('end', () => {
    const json = JSON.parse(data);
    if(json.models) {
      console.log(json.models.map(m => m.name).join('\n'));
    } else {
      console.log("API Error:", json);
    }
  });
});

req.on('error', error => { console.error(error); });
req.end();
