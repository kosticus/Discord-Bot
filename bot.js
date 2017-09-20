'use strict'

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

var Discord = require('discord.io');
var logger  = require('winston');
var fetch   = require('isomorphic-unfetch');
var express = require('express');
var app     = express();
var config = {
  "consumerKey": process.env.CONSUMER_KEY,
  "consumerSecret": process.env.CONSUMER_SECRET,
  "accessToken": process.env.ACCESS_TOKEN,
  "accessTokenSecret": process.env.ACCESS_TOKEN_SECRET,
  "callbackUrl": process.env.CALLBACK_URL
}
var allowedUserIds = process.env.ALLOWED_USER_IDS.split(',');
var Twitter = require('twitter-node-client').Twitter;
var twitter = new Twitter(config);

/* @TODO: Look into these - not firing */
app.get('/', function (req, res) {
  res.send('Hello World');
});

app.all('/twitter/callback', function (req, res) {
  res.send('Hello');
});

app.listen(process.env.PORT);
console.log('listening on ', process.env.PORT);

// Callback functions
/* @TODO: Move into utility file */
function error (err, response, body) {
  console.log('ERROR [%s]', err);
};
function success (data) {
  console.log('Data [%s]', data);
};
function postAsPromised (data) {
  return new Promise(function (resolve, reject) {
    twitter.postMedia({
      media_data: data
    }, reject, resolve)
  });
}
function isApprovedUser (userID) {
  return allowedUserIds.indexOf(userID) === -1 ? false : true;
}
function isTweetEmoji (emoji) {
  /* Could set this as process.env variable or array if wanted */
  return emoji.id === '359853241728499713' || emoji.name === 'tweet';
}
function tweetWithAttachments (evt, message) {
  /* Not sure you can actually upload more than one thing at a time.... */
  return Promise.all(evt.d.attachments.map(item => {
    // do stuff
    return fetch(item.url)
      .then(res => res.buffer())
      .then(buffer => buffer.toString('base64'))
      .then(data => postAsPromised(data))
      .then(data => JSON.parse(data).media_id_string)
      .catch(console.log); /* @TODO: Better error handling, possibly don't even tweet without image? */
  }))
  .then(array => {
    const string = array.join(',');
    twitter.postTweet({
      status: message,
      media_ids: string
    }, error, success)
  })
}
function tweet (message) {
  return twitter.postTweet({
    status: message
  }, error, success);
}

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
  colorize: true
});
logger.level = 'debug';

/* @TODO: Make this more dynamic - could be active in more channels */
var activeChannelID;

// Initialize Discord Bot
var bot = new Discord.Client({
  token: process.env.AUTH_TOKEN,
  autorun: true
});

bot.on('ready', function (evt) {
  logger.info('Connected');
  logger.info('Logged in as: ');
  logger.info(bot.username + ' - (' + bot.id + ')');
});

bot.on('message', function (user, userID, channelID, message, evt) {
  const authorId = evt.d.author.id;
  if (!isApprovedUser(authorId)) { return; }
  /* On every message in active channel, if bot is active, post message to Twitter */
  if (activeChannelID === channelID && message.substring(0,1) !== '!') {

    /* If there are attachments, upload first and then upload tweet */
    if (evt.d && evt.d.attachments.length) {
      tweetWithAttachments(evt, message);
    } else {
      /* No attachments, straight tweet */
      tweet(message);
    }
  }

  // Our bot needs to know if it will execute a command
  // It will listen for messages that will start with `!`
  if (message.substring(0, 1) == '!') {
    var args = message.substring(1).split(' ');
    var cmd = args[0];
    
    args = args.splice(1);
    switch(cmd) {
      case 'activate':
      /* Only allow one active channel at a time for now - @TODO: multiple active channels */
      if (!activeChannelID) {
        activeChannelID = channelID;
      }
        break;
      case 'deactivate':
        if (activeChannelID === channelID) {
          activeChannelID = undefined;
        }
        break;
      case 'ping':
        bot.sendMessage({
          to: channelID,
          message: 'Pong!'
        });
      default:
      break;
    }
  }
});

bot.on('any', function (event) {
  const type = event.t;
  const data = event.d;
  let userID;
  let channelID;
  if (data) {
    userID = data.user_id;
    channelID = data.channel_id;
  }

  if (type === 'MESSAGE_REACTION_ADD' && channelID && data.message_id) {
    if (isApprovedUser(userID) && isTweetEmoji(data.emoji)) {
      bot.getMessage({ channelID: channelID, messageID: data.message_id }, (err, msg) => {
        if (msg) {
          /* Only tweet once */
          const reactions = msg.reactions;
          console.log('reactions', reactions);
          const tweetCount = reactions.find(item => isTweetEmoji(item.emoji)).count;
          if (tweetCount > 1) { return; }
  
          if (msg.attachments.length) {
            // tweetWithAttachments({ d: msg }, msg.content);
          } else {
            // tweet(msg.content);
          }
        }
      });
    }
  }
});

bot.on('disconnect', function (errMsg, code) {
  logger.error('DISCONNECTED', errMsg);
  logger.error('CODE: ', code);

  bot.connect();
});