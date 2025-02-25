/**
 * Copyright 2019 Artificial Solutions. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *    http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const http = require('http');
const express = require('express');
const qs = require('querystring');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const TIE = require('@artificialsolutions/tie-api-client');
const dotenv = require('dotenv');
dotenv.config();
const {
  TENEO_ENGINE_URL,
  LANGUAGE_STT,
  LANGUAGE_TTS,
  PORT, 
  TWILIO_WORKFLOW_WEBHOOK_URL
} = process.env;
const port = PORT || 1337;
const teneoApi = TIE.init(TENEO_ENGINE_URL);
const twilio_workflow_webhook_url = TWILIO_WORKFLOW_WEBHOOK_URL;
let language_STT = LANGUAGE_STT || 'en-US'; // See: https://www.twilio.com/docs/voice/twiml/gather#languagetags
let language_TTS = LANGUAGE_TTS || 'Polly.Joanna'; // See: https://www.twilio.com/docs/voice/twiml/say/text-speech#amazon-polly

console.log("LANGUAGE_STT: " + LANGUAGE_STT);
console.log("LANGUAGE_TTS: " + LANGUAGE_TTS);
console.log("TWILIO_WORKFLOW_WEBHOOK_URL: " + twilio_workflow_webhook_url);

// initialise session handler, to store mapping between twillio CallSid and engine session id
const sessionHandler = SessionHandler();

// initialize an Express application
const app = express();
const router = express.Router();

// Tell express to use this router with /api before.
app.use("/", router);

// twilio message comes in
router.post("/", handleTwilioMessages(sessionHandler));

//test luis, I do not remember what is this for.
const urlencoded = require('body-parser').urlencoded;
app.use(urlencoded({ extended: false }));

// handle incoming twilio message
function handleTwilioMessages(sessionHandler) {
  return (req, res) => {

    let body = '';
    req.on('data', function (data) {
      body += data;
    });

    req.on('end', async function () {

      // parse the body
      const post = qs.parse(body);
      //log the parsed body. Removed as it is a little verbose
      //console.log("Post body parsed:");
      //console.log(post);
	    
      // get the caller phone number
      const caller = post.Caller;
      console.log(`Caller: ${caller}`);

      // get the caller id
      const callSid = post.CallSid;
      console.log(`CallSid: ${callSid}`);

      // check if we have stored an engine sessionid for this caller
      const teneoSessionId = sessionHandler.getSession(callSid);
	  
      // check for Digits field
      let digitsCaptured = '';
      try {
        digitsCaptured = String(post.Digits);
        if ((digitsCaptured === undefined) | (digitsCaptured == 'undefined')){ //no digits came in the request
          digitsCaptured = ''; //blank to pass it to Teneo
        }
      } catch (error) {
        // no need to do anything, but you could do this:
        console.error(error);
        console.log('No digits captured');
      }
	    
      let callerCountry = '';
      if (post.CallerCountry) {
        callerCountry = post.CallerCountry;
      }

      // get transcipt of user's spoken response
      let userInput = '';
      let confidence = '';
      if (post.CallStatus = 'in-progress' && post.SpeechResult) {
        userInput = post.SpeechResult;
        if (post.Confidence) {
          confidence = post.Confidence;
        }
      }
      console.log(`userInput: ${userInput}`);
      console.log(`confidence: ${confidence}`);
      console.log(`callerCountry: ${callerCountry}`);
      console.log(`digitsCaptured: ${digitsCaptured}`);

      // send input to engine using stored sessionid and retreive response
      const teneoResponse = await teneoApi.sendInput(teneoSessionId, { 'text': userInput, 'channel': 'twilio', 'digits': digitsCaptured, 'twilioConfidence' : confidence, 'twilioCallerCountry' : callerCountry, 'twilioSessionId' : callSid, 'phoneNumber' : caller });
      console.log(`teneoResponse: ${teneoResponse.output.text}`)

      // store engine sessionid for this caller
      sessionHandler.setSession(callSid, teneoResponse.sessionId);

      // prepare message to return to twilio
      sendTwilioMessage(teneoResponse, res);
    });
  }
}


function sendTwilioMessage(teneoResponse, res) {

  const twiml = new VoiceResponse();
  let response = null;

  // If the output parameter 'twilio_customVocabulary' exists, it will be used for custom vocabulary understanding.
  // This should be a string separated list of words to recognize
  var customVocabulary = '';
  if (teneoResponse.output.parameters.twilio_customVocabulary) {
    customVocabulary = teneoResponse.output.parameters.twilio_customVocabulary;
    console.log(`customVocabulary: ${customVocabulary}`);
  }

  // If the output parameter 'twilio_customTimeout' exists, it will be used to set a custom speech timeout.
  // Otherwise end of speech detection will be set to automatic
  var customTimeout = 'auto';
  if (teneoResponse.output.parameters.twilio_customTimeout) {
    customTimeout = teneoResponse.output.parameters.twilio_customTimeout;
  }
  
  // If the output parameter 'twilio_speechModel' exists, it will be used to set a custom speech model. Allowed values are: 'default', 'numbers_and_commands' and 'phone_call'.
  var customSpeechModel = 'default';
  if (teneoResponse.output.parameters.twilio_speechModel) {
    customSpeechModel = teneoResponse.output.parameters.twilio_speechModel;
  }  

  // If the output parameter 'twilio_inputType' exists, it will be used to set a custom input type. Allowed values are: 'dtmf', 'speech' or 'dtmf speech'  
  var customInputType = 'speech';
  if (teneoResponse.output.parameters.twilio_inputType) {
    customInputType = teneoResponse.output.parameters.twilio_inputType;
  }  

  if(teneoResponse.output.parameters.twilio_sttLanguage) {
    language_STT = teneoResponse.output.parameters.twilio_sttLanguage;
    console.log("language_STT: " + language_STT);
  }
	
  if(teneoResponse.output.parameters.twilio_ttsLanguage) {
    language_TTS = teneoResponse.output.parameters.twilio_ttsLanguage;
    console.log("language_TTS: " + language_TTS);
  }

  // If the output parameter 'twilio_endCall' exists, the call will be ended
  if (teneoResponse.output.parameters.twilio_endCall == 'true') {
    twiml.say({
      voice: language_TTS
    },teneoResponse.output.text);
//TESTING: play music before hangup
    console.log("detected hangup, trying to play file...");
    twiml.play({
    loop: 1}, 'https://demos-luis.artificial-solutions.com/artisoldemo/wait.mp3');
    console.log("... end playing file, trying to hangup");
//TESTING: end
    response = twiml.hangup();
  }

//Twilio Flex Contact Center, get the name of the Queue from Teneo
  if (teneoResponse.output.parameters.twilio_Queue) {
    var TQ = teneoResponse.output.parameters.twilio_Queue;
    console.log("Queue name coming from Teneo: "+TQ);
    twiml.say({
      voice: language_TTS
    },teneoResponse.output.text);
    //To pass the control back to the Twilio Workflow, we need a redirect with a mandatory variable "FlowEvent=return"
    twiml.redirect({
      method: 'POST'
      }, twilio_workflow_webhook_url+'?FlowEvent=return&QueueName='+TQ);  
  } //end if queue parameter	  

	  
  //if teneo engine request to get digits, then the connector will change the input to dtmf to get the digits.
  else if (teneoResponse.output.parameters.twilio_getDigits == "true") {
    console.log("twilio_getDigits: true");
    response = twiml.gather({
      input: 'dtmf',
      actionOnEmptyResult:'true'
    });
    response.say({
      voice:language_TTS
    }, teneoResponse.output.text);
  }
  //in any other case, the response is created and delivered.
  else {
    response = twiml.gather({
      language: language_STT,
      hints: customVocabulary,
      input: customInputType,
      speechTimeout: customTimeout,
      speechModel: customSpeechModel,
      actionOnEmptyResult : 'true'
    });

    response.say({
      voice: language_TTS
    }, teneoResponse.output.text);
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
}

/***
 * SESSION HANDLER
 ***/
function SessionHandler() {

  // Map the Twilio CallSid id to the teneo engine session id. 
  // This code keeps the map in memory, which is ok for testing purposes
  // For production usage it is advised to make use of more resilient storage mechanisms like redis
  const sessionMap = new Map();

  return {
    getSession: (userId) => {
      if (sessionMap.size > 0) {
        return sessionMap.get(userId);
      }
      else {
        return "";
      }
    },
    setSession: (userId, sessionId) => {
      sessionMap.set(userId, sessionId)
    }
  };
}

// start the express application
http.createServer(app).listen(port, () => {
  console.log(`Listening on port: ${port}`);
});
